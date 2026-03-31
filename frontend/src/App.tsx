import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import './App.css'

function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()

  if (!configured) {
    return '/api'
  }

  const normalized = configured.replace(/\/+$/, '')

  try {
    const resolvedUrl = new URL(normalized, window.location.origin)
    const isLocalApiHost = resolvedUrl.hostname === '127.0.0.1' || resolvedUrl.hostname === 'localhost'
    const isLocalBrowserHost =
      window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'

    if (isLocalApiHost && !isLocalBrowserHost) {
      return '/api'
    }
  } catch {
    return '/api'
  }

  return normalized
}

const API_BASE_URL = resolveApiBaseUrl()

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
  cover_image?: string | null
}

interface Page extends PageSummary {
  reading_time_min: number
  content_md: string
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

function resolveCoverImageSrc(rawValue: string): string {
  const value = rawValue.trim()

  if (!value) {
    return value
  }

  if (/^(?:https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
    return value
  }

  if (value.startsWith('/')) {
    try {
      return new URL(value, window.location.origin).toString()
    } catch {
      return value
    }
  }

  if (value.startsWith('api/')) {
    try {
      return new URL(`/${value}`, window.location.origin).toString()
    } catch {
      return value
    }
  }

  const normalizedPath = value.startsWith('media/') ? value : `media/${value}`

  try {
    const baseUrl = new URL(`${API_BASE_URL}/`, window.location.origin)
    return new URL(normalizedPath, baseUrl).toString()
  } catch {
    return value
  }
}

function formatDate(value: string): string {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleDateString('it-IT', {
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
        <p className="eyebrow">Hub cittadino</p>
        <h1>Scopri Monterotondo, un QR alla volta.</h1>
        <p className="lead">
          Scansiona un codice QR, o seleziona una pagina qui sotto.
        </p>
      </section>

      {status === 'loading' && (
        <section className="notice">Caricamento pagine in evidenza dall'API...</section>
      )}

      {status === 'error' && (
        <section className="notice notice-error">
          Impossibile raggiungere il backend. Avvia l'API Rust sulla porta 23051 e aggiorna.
        </section>
      )}

      {status === 'ready' && (
        <section className="cards-grid" aria-label="Pagine in evidenza">
          {featuredPages.map((page, index) => {
            const coverImageSrc = page.cover_image ? resolveCoverImageSrc(page.cover_image) : null

            return (
              <article
                className="page-card"
                key={page.slug}
                style={
                  coverImageSrc
                    ? {
                      animationDelay: `${index * 90}ms`,
                      backgroundImage: `linear-gradient(160deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.8)), url("${coverImageSrc}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                    }
                    : { animationDelay: `${index * 90}ms` }
                }
              >
                <p className="page-card-meta">
                  {page.category} · Aggiornato {formatDate(page.updated_at)}
                </p>
                <h2>{page.title}</h2>
                <p>{page.summary}</p>
                <Link className="inline-link" to={`/p/${page.slug}`}>
                  Leggi articolo
                </Link>
              </article>
            )
          })}
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
        Pagina non trovata. Torna alla <Link to="/">pagina iniziale</Link>.
      </section>
    )
  }

  if (status === 'loading') {
    return <section className="notice">Caricamento articolo...</section>
  }

  if (status === 'not-found') {
    return (
      <section className="notice notice-error">
        Pagina non trovata. Torna alla <Link to="/">pagina iniziale</Link>.
      </section>
    )
  }

  if (status === 'error' || !page) {
    return (
      <section className="notice notice-error">
        Impossibile caricare questo articolo adesso. Riprova.
      </section>
    )
  }

  const coverImageSrc = page.cover_image ? resolveCoverImageSrc(page.cover_image) : null

  return (
    <article className="article-shell">
      <Link className="inline-link" to="/">
        ← Torna alle pagine in evidenza
      </Link>

      <header className="article-header">
        <p className="eyebrow">{page.category}</p>
        <h1>{page.title}</h1>
        <p className="lead">{page.summary}</p>
      </header>

      {coverImageSrc && <img alt={page.title} className="article-cover" loading="lazy" src={coverImageSrc} />}

      <div className="article-meta">
        <span>Aggiornato {formatDate(page.updated_at)}</span>
        <span>{page.reading_time_min} min di lettura</span>
      </div>

      <div className="article-content article-markdown">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
          {page.content_md}
        </ReactMarkdown>
      </div>
    </article>
  )
}

function NotFoundPage() {
  return (
    <section className="notice notice-error">
      Percorso sconosciuto. Prova la <Link to="/">pagina iniziale</Link>.
    </section>
  )
}

function App() {
  return (
    <div className="app-shell">
      <header className="top-bar">
        <Link className="brand" to="/">
          Pagine Eretine
        </Link>

        <nav className="top-nav" aria-label="Navigazione principale">
          <NavLink
            className={({ isActive }) =>
              isActive ? 'top-nav-link top-nav-link-active' : 'top-nav-link'
            }
            to="/"
          >
            Vai alla Home
          </NavLink>
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
          Versione in sviluppo. I contenuti di questa pagina sono segnaposti di prova generati con intelligenza artificiale.
        </p>
      </footer>
    </div>
  )
}

export default App
