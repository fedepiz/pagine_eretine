use axum::{
    Json, Router,
    extract::Path,
    http::{HeaderValue, Method, StatusCode},
    routing::{get, get_service},
};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use slotmap::{SlotMap, new_key_type};
use std::{
    collections::{HashMap, HashSet},
    fs,
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};
use tokio::sync::RwLock;
use tokio::time::Duration;
use tower_http::{cors::CorsLayer, services::ServeDir};

const PAGES_DIR: &str = "pages";
const PAGE_MEDIA_DIR: &str = "media";
const PORT: u16 = 23051;

#[derive(Clone)]
struct AppState {
    page_store: Arc<RwLock<PageStore>>,
}

new_key_type! { struct PageId; }

#[derive(Default)]
struct PageStore {
    pages: SlotMap<PageId, Page>,
    by_slug: HashMap<String, PageId>,
}

impl PageStore {
    pub fn insert(&mut self, page: Page) {
        let id = self.by_slug.get(&page.slug).copied();
        match id {
            Some(id) => self.pages[id] = page,
            None => {
                let key = page.slug.clone();
                let id = self.pages.insert(page);
                self.by_slug.insert(key, id);
            }
        }
    }
}

#[derive(Clone, Serialize)]
struct PageSummary {
    slug: String,
    title: String,
    summary: String,
    category: String,
    updated_at: String,
    cover_image: Option<String>,
    lat: f64,
    lon: f64,
}

#[derive(Clone, Serialize)]
struct Page {
    slug: String,
    title: String,
    summary: String,
    category: String,
    updated_at: String,
    cover_image: Option<String>,
    lat: f64,
    lon: f64,
    reading_time_min: u8,
    content_md: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    pages: usize,
}

#[derive(Deserialize)]
struct PageFrontMatter {
    title: String,
    summary: String,
    category: String,
    updated_at: String,
    #[serde(default, alias = "cover-image")]
    cover_image: Option<String>,
    #[serde(default)]
    reading_time_min: Option<u8>,
    #[serde(default)]
    lat: f64,
    #[serde(default, alias = "long", alias = "lng")]
    lon: f64,
    #[serde(default)]
    published: Option<bool>,
}

#[tokio::main]
async fn main() {
    let pages_directory = PathBuf::from(PAGES_DIR);

    let pages = load_pages_from_dir(&pages_directory)
        .unwrap_or_else(|error| panic!("Failed to load markdown pages: {error}"));

    let mut page_store = PageStore::default();
    for page in pages {
        page_store.insert(page);
    }

    let app_state = AppState {
        page_store: Arc::new(RwLock::new(page_store)),
    };

    spawn_pages_watcher(app_state.clone(), pages_directory);

    let app = Router::new()
        .route("/", get(root))
        .route("/api/health", get(health))
        .route("/api/pages", get(list_pages))
        .route("/api/pages/{slug}", get(get_page))
        .nest_service("/api/media", get_service(ServeDir::new(PAGE_MEDIA_DIR)))
        .with_state(app_state)
        .layer(cors_layer());

    let port = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(PORT);

    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("Failed to bind backend TCP listener");

    println!(
        "Backend listening on http://{}",
        listener.local_addr().unwrap()
    );

    axum::serve(listener, app)
        .await
        .expect("Backend server failed unexpectedly");
}

async fn root() -> &'static str {
    "Monterotondo backend is up"
}

async fn health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<HealthResponse> {
    let page_store = state.page_store.read().await;

    Json(HealthResponse {
        status: "ok",
        pages: page_store.pages.len(),
    })
}

async fn list_pages(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<Vec<PageSummary>> {
    let page_store = state.page_store.read().await;

    let summaries = page_store
        .pages
        .values()
        .map(|page| PageSummary {
            slug: page.slug.clone(),
            title: page.title.clone(),
            summary: page.summary.clone(),
            category: page.category.clone(),
            updated_at: page.updated_at.clone(),
            cover_image: page.cover_image.clone(),
            lat: page.lat,
            lon: page.lon,
        })
        .collect();

    Json(summaries)
}

async fn get_page(
    Path(slug): Path<String>,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<Page>, StatusCode> {
    let store = state.page_store.read().await;

    let page = store
        .by_slug
        .get(&slug)
        .and_then(|&id| store.pages.get(id))
        .cloned()
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(page))
}

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://localhost:5173"),
            HeaderValue::from_static("http://127.0.0.1:5173"),
        ])
        .allow_methods([Method::GET, Method::HEAD])
}

fn spawn_pages_watcher(state: AppState, pages_directory: PathBuf) {
    tokio::spawn(async move {
        let (event_tx, mut event_rx) =
            tokio::sync::mpsc::unbounded_channel::<notify::Result<Event>>();

        let mut watcher = match notify::recommended_watcher(move |event| {
            let _ = event_tx.send(event);
        }) {
            Ok(watcher) => watcher,
            Err(error) => {
                eprintln!("Failed to initialize markdown watcher: {error}");
                return;
            }
        };

        if let Err(error) = watcher.watch(&pages_directory, RecursiveMode::NonRecursive) {
            eprintln!(
                "Failed to watch markdown directory '{}': {error}",
                pages_directory.display()
            );
            return;
        }

        println!(
            "Watching '{}' for markdown page changes.",
            pages_directory.display()
        );

        loop {
            let Some(event_result) = event_rx.recv().await else {
                break;
            };

            let mut affected_slugs = HashSet::new();
            collect_affected_slugs(&event_result, &mut affected_slugs);

            if affected_slugs.is_empty() {
                continue;
            }

            tokio::time::sleep(Duration::from_millis(250)).await;

            while let Ok(queued_result) = event_rx.try_recv() {
                collect_affected_slugs(&queued_result, &mut affected_slugs);
            }

            reload_affected_pages(&state, &pages_directory, &affected_slugs).await;
        }
    });
}

fn collect_affected_slugs(
    event_result: &notify::Result<Event>,
    affected_slugs: &mut HashSet<String>,
) {
    let event = match event_result {
        Ok(event) => event,
        Err(error) => {
            eprintln!("Markdown watcher error: {error}");
            return;
        }
    };

    if !matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any
    ) {
        return;
    }

    for path in &event.paths {
        if !is_markdown_path(path) {
            continue;
        }

        let Some(slug) = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
        else {
            continue;
        };

        affected_slugs.insert(slug);
    }
}

async fn reload_affected_pages(
    state: &AppState,
    pages_directory: &FsPath,
    affected_slugs: &HashSet<String>,
) {
    enum OnReload {
        Upsert(Page),
        Remove(String),
    }

    let mut planned_changes = Vec::new();

    for slug in affected_slugs {
        let page_path = pages_directory.join(format!("{slug}.md"));

        if !page_path.is_file() {
            planned_changes.push(OnReload::Remove(slug.clone()));
            continue;
        }

        match load_page_from_file(&page_path) {
            Ok(Some(page)) => {
                planned_changes.push(OnReload::Upsert(page));
            }
            Ok(None) => {
                planned_changes.push(OnReload::Remove(slug.clone()));
            }
            Err(error) => {
                eprintln!("Failed to reload '{}': {error}", page_path.display());
            }
        }
    }

    if planned_changes.is_empty() {
        return;
    }

    let mut page_store = state.page_store.write().await;
    let mut upserted = 0usize;
    let mut removed = 0usize;

    for change in planned_changes {
        match change {
            OnReload::Upsert(page) => {
                page_store.insert(page);
                upserted += 1;
            }
            OnReload::Remove(slug) => {
                if page_store.by_slug.remove(&slug).is_some() {
                    removed += 1;
                }
            }
        }
    }

    if upserted == 0 && removed == 0 {
        return;
    }

    println!(
        "Reloaded affected pages dynamically (updated: {upserted}, removed: {removed}, total: {}).",
        page_store.pages.len()
    );
}

fn is_markdown_path(path: &FsPath) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("md"))
}

fn load_pages_from_dir(directory: &FsPath) -> Result<Vec<Page>, String> {
    let entries = fs::read_dir(directory).map_err(|error| {
        format!(
            "Could not read '{}' directory: {error}",
            directory.display()
        )
    })?;

    let mut pages = Vec::new();
    let mut seen_slugs = HashSet::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let path = entry.path();

        if !path.is_file() || !is_markdown_path(&path) {
            continue;
        }

        let Some(page) = load_page_from_file(&path)? else {
            continue;
        };

        if !seen_slugs.insert(page.slug.clone()) {
            return Err(format!(
                "Duplicate slug '{}' found in markdown pages.",
                page.slug
            ));
        }

        pages.push(page);
    }

    sort_pages(&mut pages);

    Ok(pages)
}

fn load_page_from_file(path: &FsPath) -> Result<Option<Page>, String> {
    let slug = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Invalid page filename '{}'.", path.display()))?
        .to_string();

    validate_slug(&slug).map_err(|message| format!("{} ({})", message, path.display()))?;

    let raw_markdown = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))?;

    let (front_matter_raw, body_raw) = split_front_matter(&raw_markdown)
        .map_err(|message| format!("{} ({})", message, path.display()))?;

    let front_matter: PageFrontMatter = serde_yaml::from_str(&front_matter_raw)
        .map_err(|error| format!("Invalid front matter in '{}': {error}", path.display()))?;

    if front_matter.published == Some(false) {
        return Ok(None);
    }

    validate_front_matter(&front_matter, path)?;

    let content_md = body_raw.trim().to_string();
    if content_md.is_empty() {
        return Err(format!(
            "Markdown body cannot be empty in '{}'.",
            path.display()
        ));
    }

    let reading_time_min = front_matter
        .reading_time_min
        .unwrap_or_else(|| estimate_reading_time_minutes(&content_md))
        .max(1);

    Ok(Some(Page {
        slug,
        title: front_matter.title.trim().to_string(),
        summary: front_matter.summary.trim().to_string(),
        category: front_matter.category.trim().to_string(),
        updated_at: front_matter.updated_at.trim().to_string(),
        cover_image: front_matter
            .cover_image
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        lat: front_matter.lat,
        lon: front_matter.lon,
        reading_time_min,
        content_md,
    }))
}

fn sort_pages(pages: &mut [Page]) {
    pages.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.slug.cmp(&b.slug))
    });
}

fn split_front_matter(raw_markdown: &str) -> Result<(String, String), String> {
    let mut lines = raw_markdown.lines();

    let Some(first_line) = lines.next() else {
        return Err("Markdown file is empty.".to_string());
    };

    if first_line.trim_end_matches('\r') != "---" {
        return Err("Markdown file must start with YAML front matter delimiter '---'.".to_string());
    }

    let mut front_matter_lines = Vec::new();
    let mut found_closing_delimiter = false;

    for line in &mut lines {
        if line.trim_end_matches('\r') == "---" {
            found_closing_delimiter = true;
            break;
        }

        front_matter_lines.push(line.trim_end_matches('\r'));
    }

    if !found_closing_delimiter {
        return Err("Front matter is missing a closing '---' delimiter.".to_string());
    }

    let body = lines
        .map(|line| line.trim_end_matches('\r'))
        .collect::<Vec<_>>()
        .join("\n");

    Ok((front_matter_lines.join("\n"), body))
}

fn validate_front_matter(front_matter: &PageFrontMatter, path: &FsPath) -> Result<(), String> {
    if front_matter.title.trim().is_empty() {
        return Err(format!(
            "Missing required 'title' in front matter ({})",
            path.display()
        ));
    }

    if front_matter.summary.trim().is_empty() {
        return Err(format!(
            "Missing required 'summary' in front matter ({})",
            path.display()
        ));
    }

    if front_matter.category.trim().is_empty() {
        return Err(format!(
            "Missing required 'category' in front matter ({})",
            path.display()
        ));
    }

    if front_matter.updated_at.trim().is_empty() {
        return Err(format!(
            "Missing required 'updated_at' in front matter ({})",
            path.display()
        ));
    }

    Ok(())
}

fn validate_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty() {
        return Err("Slug cannot be empty.".to_string());
    }

    if slug.starts_with('-') || slug.ends_with('-') {
        return Err(format!(
            "Slug '{slug}' cannot start or end with '-' characters."
        ));
    }

    if slug.contains("--") {
        return Err(format!(
            "Slug '{slug}' cannot contain consecutive '-' characters."
        ));
    }

    if !slug
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(format!(
            "Slug '{slug}' must contain only lowercase letters, numbers, and '-'."
        ));
    }

    Ok(())
}

fn estimate_reading_time_minutes(content_md: &str) -> u8 {
    let words = content_md.split_whitespace().count();
    if words == 0 {
        return 1;
    }

    let minutes = ((words as f64) / 200.0).ceil() as usize;
    let bounded = minutes.clamp(1, u8::MAX as usize);
    bounded as u8
}
