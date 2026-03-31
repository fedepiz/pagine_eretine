import { Link } from 'react-router-dom'

export interface PageCardData {
  slug: string
  title: string
  summary: string
  category: string
  updated_at: string
  cover_image?: string | null
}

interface PageCardProps {
  page: PageCardData
  formattedUpdatedAt: string
  coverImageSrc?: string | null
  className?: string
  animationDelayMs?: number
}

export function PageCard({
  page,
  formattedUpdatedAt,
  coverImageSrc,
  className,
  animationDelayMs,
}: PageCardProps) {
  const style = coverImageSrc
    ? {
      animationDelay: animationDelayMs ? `${animationDelayMs}ms` : undefined,
      backgroundImage: `linear-gradient(160deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.8)), url("${coverImageSrc}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    }
    : {
      animationDelay: animationDelayMs ? `${animationDelayMs}ms` : undefined,
    }

  return (
    <article className={className ? `page-card ${className}` : 'page-card'} style={style}>
      <p className="page-card-meta">
        {page.category} · Aggiornato {formattedUpdatedAt}
      </p>
      <h2>{page.title}</h2>
      <p>{page.summary}</p>
      <Link className="inline-link" to={`/p/${page.slug}`}>
        Vai alla pagina
      </Link>
    </article>
  )
}
