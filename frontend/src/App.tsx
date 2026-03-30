import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

type HomeStatus = 'loading' | 'ready' | 'error'
type ArticleStatus = 'loading' | 'ready' | 'not-found' | 'error'

interface ApiError extends Error {
  status?: number
}

interface PageSummary {
  slug: string
  title: string
  summary: string
  category: string
  updated_at: string
}

interface Page extends PageSummary {
  reading_time_min: number
  sections: string[]
  highlights: string[]
}

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`)

  if (!response.ok) {
    const error: ApiError = new Error(`Request failed with status ${response.status}`)
    error.status = response.status
    throw error
  }

  return response.json() as Promise<T>
}

function formatDate(value: string): string {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function HomePage() {
  const [pages, setPages] = useState<PageSummary[]>([])
  const [status, setStatus] = useState<HomeStatus>('loading')

  useEffect(() => {
    let cancelled = false

    const loadPages = async () => {
      try {
        const data = await apiFetch<PageSummary[]>('/pages')

        if (!cancelled) {
          setPages(data)
          setStatus('ready')
        }
      } catch {
        if (!cancelled) {
          setStatus('error')
        }
      }
    }

    loadPages()

    return () => {
      cancelled = true
    }
  }, [])

  const featuredPages = useMemo(() => pages.slice(0, 6), [pages])

  return (
    <>
      <section className="hero-panel">
        <p className="eyebrow">Town knowledge hub</p>
        <h1>Explore Monterotondo, one QR code at a time.</h1>
        <p className="lead">
          This starter app serves wiki-like pages from an Axum backend. Scan a QR code,
          open an article route, and get local context in seconds.
        </p>
        <div className="hero-actions">
          <Link
            className="button button-primary"
            to={featuredPages[0] ? `/p/${featuredPages[0].slug}` : '/'}
          >
            Open sample article
          </Link>
        </div>
      </section>

      {status === 'loading' && (
        <section className="notice">Loading page highlights from the API...</section>
      )}

      {status === 'error' && (
        <section className="notice notice-error">
          Could not reach the backend. Start Rust API on port 3000 and refresh.
        </section>
      )}

      {status === 'ready' && (
        <section className="cards-grid" aria-label="Highlighted pages">
          {featuredPages.map((page, index) => (
            <article
              className="page-card"
              key={page.slug}
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <p className="page-card-meta">
                {page.category} · Updated {formatDate(page.updated_at)}
              </p>
              <h2>{page.title}</h2>
              <p>{page.summary}</p>
              <Link className="inline-link" to={`/p/${page.slug}`}>
                Read article
              </Link>
            </article>
          ))}
        </section>
      )}
    </>
  )
}

function ArticlePage() {
  const { slug } = useParams()
  const missingSlug = !slug
  const [page, setPage] = useState<Page | null>(null)
  const [status, setStatus] = useState<ArticleStatus>('loading')

  useEffect(() => {
    if (missingSlug) {
      return
    }

    let cancelled = false

    const loadPage = async () => {
      try {
        const data = await apiFetch<Page>(`/pages/${slug}`)

        if (!cancelled) {
          setPage(data)
          setStatus('ready')
        }
      } catch (caughtError) {
        if (!cancelled) {
          const error = caughtError as ApiError
          setStatus(error.status === 404 ? 'not-found' : 'error')
        }
      }
    }

    loadPage()

    return () => {
      cancelled = true
    }
  }, [missingSlug, slug])

  if (missingSlug) {
    return (
      <section className="notice notice-error">
        Page not found. Return to <Link to="/">the home page</Link>.
      </section>
    )
  }

  if (status === 'loading') {
    return <section className="notice">Loading article...</section>
  }

  if (status === 'not-found') {
    return (
      <section className="notice notice-error">
        Page not found. Return to <Link to="/">the home page</Link>.
      </section>
    )
  }

  if (status === 'error' || !page) {
    return (
      <section className="notice notice-error">
        Could not load this article right now. Please try again.
      </section>
    )
  }

  return (
    <article className="article-shell">
      <Link className="inline-link" to="/">
        ← Back to highlighted pages
      </Link>

      <header className="article-header">
        <p className="eyebrow">{page.category}</p>
        <h1>{page.title}</h1>
        <p className="lead">{page.summary}</p>
      </header>

      <div className="article-meta">
        <span>Updated {formatDate(page.updated_at)}</span>
        <span>{page.reading_time_min} min read</span>
        <span>Slug: {page.slug}</span>
      </div>

      <div className="article-content">
        {page.sections.map((section, index) => (
          <p key={`${page.slug}-${index}`}>{section}</p>
        ))}
      </div>

      <aside className="highlight-box">
        <h2>Quick highlights</h2>
        <ul>
          {page.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </aside>
    </article>
  )
}

function NotFoundPage() {
  return (
    <section className="notice notice-error">
      Unknown route. Try <Link to="/">the home page</Link>.
    </section>
  )
}

function App() {
  return (
    <div className="app-shell">
      <header className="top-bar">
        <Link className="brand" to="/">
          Monterotondo Pages
        </Link>

        <nav className="top-nav" aria-label="Main navigation">
          <NavLink
            className={({ isActive }) =>
              isActive ? 'top-nav-link top-nav-link-active' : 'top-nav-link'
            }
            to="/"
          >
            Home
          </NavLink>
          <a
            className="top-nav-link"
            href={`${API_BASE_URL}/health`}
            rel="noreferrer"
            target="_blank"
          >
            API health
          </a>
        </nav>
      </header>

      <main className="main-content">
        <Routes>
          <Route element={<HomePage />} path="/" />
          <Route element={<ArticlePage />} path="/p/:slug" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
      </main>

      <footer className="footer">
        <p>
          Bootstrap version with synthetic data. Scan-ready routes live under
          <code>/p/&lt;slug&gt;</code>.
        </p>
      </footer>
    </div>
  )
}

export default App
