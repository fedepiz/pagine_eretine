import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { InteractiveMap } from './components/InteractiveMap'
import type { MapPin } from './components/InteractiveMap'
import { PageCard } from './components/PageCard'
import type { PageCardData } from './components/PageCard'
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
const QR_COLOR_DARK = '#2b2b2b'
const QR_COLOR_LIGHT = '#ffffff'

type HomeStatus = 'loading' | 'ready' | 'error'
type ArticleStatus = 'loading' | 'ready' | 'not-found' | 'error'
type QrDownloadStatus = 'idle' | 'downloading' | 'error'

interface ApiError extends Error {
  status?: number
}

interface PageSummary extends PageCardData {
  lat: number
  lon: number
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

function resolvePagePublicUrl(slug: string): string {
  const normalizedBaseUrl = `${window.location.origin.replace(/\/+$/, '')}/`

  try {
    return new URL(`p/${encodeURIComponent(slug)}`, normalizedBaseUrl).toString()
  } catch {
    return `${window.location.origin.replace(/\/+$/, '')}/p/${encodeURIComponent(slug)}`
  }
}

async function downloadPageQrCode(slug: string): Promise<void> {
  const pageUrl = resolvePagePublicUrl(slug)
  const dataUrl = await QRCode.toDataURL(pageUrl, {
    width: 1024,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: QR_COLOR_DARK,
      light: QR_COLOR_LIGHT,
    },
  })

  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `qr-${slug}.png`

  document.body.append(link)
  link.click()
  link.remove()
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

function hasValidCoordinates(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0
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
  const pagesBySlug = useMemo(() => new Map(pages.map((page) => [page.slug, page])), [pages])
  const mapPins = useMemo<MapPin[]>(
    () =>
      pages
        .filter(
          (page) => hasValidCoordinates(page.lat, page.lon),
        )
        .map((page) => ({
          id: `page-${page.slug}`,
          slug: page.slug,
          lat: page.lat,
          lng: page.lon,
        })),
    [pages],
  )

  return (
    <>
      <section className="hero-panel">
        <p className="eyebrow">Hub cittadino</p>
        <h1>Scopri Monterotondo, un QR alla volta.</h1>
        <p className="lead">
          Scansiona un codice QR, o seleziona una pagina qui sotto.
        </p>
      </section>

      <InteractiveMap
        pins={mapPins}
        renderPinPopup={(pin) => {
          const page = pagesBySlug.get(pin.slug)

          if (!page) {
            return <p className="interactive-map-message">Pagina non disponibile.</p>
          }

          return (
            <PageCard
              className="page-card-popup"
              coverImageSrc={page.cover_image ? resolveCoverImageSrc(page.cover_image) : null}
              formattedUpdatedAt={formatDate(page.updated_at)}
              page={page}
            />
          )
        }}
      />

      <section aria-label="In Evidenza" className="section-shell">
        <div className="section-toolbar">
          <p className="section-title">In evidenza</p>
        </div>
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
              return (
                <PageCard
                  animationDelayMs={index * 90}
                  coverImageSrc={page.cover_image ? resolveCoverImageSrc(page.cover_image) : null}
                  formattedUpdatedAt={formatDate(page.updated_at)}
                  key={page.slug}
                  page={page}
                />
              )
            })}
          </section>
        )}
      </section>
    </>
  )
}

function ArticlePage() {
  const { slug } = useParams()
  const missingSlug = !slug
  const [page, setPage] = useState<Page | null>(null)
  const [status, setStatus] = useState<ArticleStatus>('loading')
  const [qrStatus, setQrStatus] = useState<QrDownloadStatus>('idle')

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
  const hasArticleMap = hasValidCoordinates(page.lat, page.lon)
  const articleMapPins: MapPin[] = hasArticleMap
    ? [{ id: `article-${page.slug}`, slug: page.slug, lat: page.lat, lng: page.lon }]
    : []

  const handleDownloadQrCode = async () => {
    if (!slug || qrStatus === 'downloading') {
      return
    }

    try {
      setQrStatus('downloading')
      await downloadPageQrCode(slug)
      setQrStatus('idle')
    } catch {
      setQrStatus('error')
    }
  }

  return (
    <div>
      <article className="article-shell">
        <div className="article-top-row">
          <Link className="inline-link article-back-link" to="/">
            ← Torna alle pagine in evidenza
          </Link>

          <button
            className="ui-button qr-download-button"
            disabled={qrStatus === 'downloading'}
            onClick={handleDownloadQrCode}
            type="button"
          >
            {qrStatus === 'downloading' ? 'Generazione QR...' : 'Scarica QR'}
          </button>
        </div>

        {qrStatus === 'error' && (
          <p className="qr-download-error">Impossibile creare il QR in questo momento. Riprova.</p>
        )}

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

        {hasArticleMap && (
          <InteractiveMap
            pins={articleMapPins}
            renderPinPopup={() => (
              <PageCard
                className="page-card-popup"
                coverImageSrc={coverImageSrc}
                formattedUpdatedAt={formatDate(page.updated_at)}
                page={page}
              />
            )}
          />
        )}
      </article>
    </div>
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
  const location = useLocation()
  const isHomePage = location.pathname === '/'

  return (
    <div className="app-shell">
      <header className="top-bar">
        <Link className="brand" to="/">
          Pagine Eretine
        </Link>

        {!isHomePage && (
          <nav className="top-nav" aria-label="Navigazione principale">
            <NavLink
              className={({ isActive }) =>
                isActive ? 'ui-button ui-button-active top-nav-link' : 'ui-button top-nav-link'
              }
              to="/"
            >
              Vai alla Home
            </NavLink>
          </nav>
        )}
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
