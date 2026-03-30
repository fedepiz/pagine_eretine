use axum::{
    Json, Router,
    extract::Path,
    http::{HeaderValue, Method, StatusCode},
    routing::get,
};
use serde::Serialize;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
struct AppState {
    pages: Vec<Page>,
}

#[derive(Clone, Serialize)]
struct PageSummary {
    slug: String,
    title: String,
    summary: String,
    category: String,
    updated_at: String,
}

#[derive(Clone, Serialize)]
struct Page {
    slug: String,
    title: String,
    summary: String,
    category: String,
    updated_at: String,
    reading_time_min: u8,
    sections: Vec<String>,
    highlights: Vec<String>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    pages: usize,
}

#[tokio::main]
async fn main() {
    let pages = synthetic_pages();

    let app_state = AppState {
        pages: pages.clone(),
    };

    let app = Router::new()
        .route("/", get(root))
        .route("/api/health", get(health))
        .route("/api/pages", get(list_pages))
        .route("/api/pages/{slug}", get(get_page))
        .with_state(app_state)
        .layer(cors_layer());

    let port = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3000);

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
    Json(HealthResponse {
        status: "ok",
        pages: state.pages.len(),
    })
}

async fn list_pages(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<Vec<PageSummary>> {
    let summaries = state
        .pages
        .iter()
        .map(|page| PageSummary {
            slug: page.slug.clone(),
            title: page.title.clone(),
            summary: page.summary.clone(),
            category: page.category.clone(),
            updated_at: page.updated_at.clone(),
        })
        .collect();

    Json(summaries)
}

async fn get_page(
    Path(slug): Path<String>,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<Page>, StatusCode> {
    let page = state
        .pages
        .iter()
        .find(|page| page.slug == slug)
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
        .allow_methods([Method::GET])
}

fn synthetic_pages() -> Vec<Page> {
    vec![
        Page {
            slug: "town-hall".to_string(),
            title: "Town Hall and Public Services".to_string(),
            summary: "Opening hours, contact points, and what can be handled at the civic desk.".to_string(),
            category: "Public services".to_string(),
            updated_at: "2026-03-30".to_string(),
            reading_time_min: 4,
            sections: vec![
                "The town hall hosts registry services, public records, and local permit requests. Main desk hours are Monday to Friday from 8:30 to 13:00, with a second afternoon opening on Tuesdays.".to_string(),
                "Several services can be pre-booked online: residence certificates, family status extracts, and identity card appointments. Walk-ins are still accepted in low-traffic hours.".to_string(),
                "The URP information desk helps route requests to the right office and can support first-time visitors with forms and basic documentation guidance.".to_string(),
            ],
            highlights: vec![
                "Registry and certificates".to_string(),
                "Booking support and walk-in hours".to_string(),
                "URP citizen help desk".to_string(),
            ],
        },
        Page {
            slug: "historic-center".to_string(),
            title: "Historic Center Walk".to_string(),
            summary: "A quick route through landmarks, viewpoints, and artisan streets in the old town.".to_string(),
            category: "Culture".to_string(),
            updated_at: "2026-03-27".to_string(),
            reading_time_min: 6,
            sections: vec![
                "Start from Piazza del Popolo and follow the gentle climb to the panoramic terrace. Along the way, small alleys reveal workshops, local bakeries, and restored facades.".to_string(),
                "Many buildings show layered architecture from medieval and modern phases. Informational plaques explain key dates and notable restorations.".to_string(),
                "The walk can be completed in around 45 minutes, but most visitors stop for photos and cafés, extending it to a relaxed afternoon route.".to_string(),
            ],
            highlights: vec![
                "Panoramic terrace viewpoint".to_string(),
                "Craft and food stops".to_string(),
                "Plaques with local history notes".to_string(),
            ],
        },
        Page {
            slug: "weekly-market".to_string(),
            title: "Weekly Market Guide".to_string(),
            summary: "Where it takes place, best arrival time, and what you can usually find.".to_string(),
            category: "Daily life".to_string(),
            updated_at: "2026-03-25".to_string(),
            reading_time_min: 5,
            sections: vec![
                "The market sets up every Thursday morning across the central parking area and nearby side streets. Stalls begin opening before 8:00 and remain active until around 13:00.".to_string(),
                "Typical offers include fresh produce, regional cheeses, household supplies, clothing basics, and occasional seasonal goods from nearby towns.".to_string(),
                "Early hours are best for full selection, while late morning is ideal for a calmer visit. Reusable bags are recommended since many stalls reduce plastic packaging.".to_string(),
            ],
            highlights: vec![
                "Thursday morning schedule".to_string(),
                "Food, home goods, and essentials".to_string(),
                "Best times for selection vs. comfort".to_string(),
            ],
        },
        Page {
            slug: "parks-and-playgrounds".to_string(),
            title: "Parks and Playgrounds".to_string(),
            summary: "Green areas for families, short walks, and shaded breaks during warm days.".to_string(),
            category: "Outdoor".to_string(),
            updated_at: "2026-03-24".to_string(),
            reading_time_min: 4,
            sections: vec![
                "The municipal park includes a loop path suitable for strollers and light jogging. Benches are distributed along shaded sections with water points nearby.".to_string(),
                "Two playground clusters are available: one for younger children with soft flooring, and a second zone with climbing elements for older kids.".to_string(),
                "Weekend mornings usually host sports groups and family activities, while weekday afternoons remain the quietest period.".to_string(),
            ],
            highlights: vec![
                "Shaded loop path".to_string(),
                "Separate play areas by age".to_string(),
                "Water points and benches".to_string(),
            ],
        },
        Page {
            slug: "local-events".to_string(),
            title: "Seasonal Events Calendar".to_string(),
            summary: "Recurring festivals, small concerts, and community events throughout the year.".to_string(),
            category: "Community".to_string(),
            updated_at: "2026-03-22".to_string(),
            reading_time_min: 5,
            sections: vec![
                "Spring and early summer host open-air cultural evenings and weekend craft fairs. Most events take place around the central squares and adjacent courtyards.".to_string(),
                "Autumn weekends often include food routes and local product tastings, coordinated with neighborhood associations and volunteer groups.".to_string(),
                "Major events are announced in advance, while smaller gatherings can appear with shorter notice through municipal channels.".to_string(),
            ],
            highlights: vec![
                "Open-air culture nights".to_string(),
                "Autumn food routes".to_string(),
                "Municipal event announcements".to_string(),
            ],
        },
    ]
}
