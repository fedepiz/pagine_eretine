import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LatLngExpression } from 'leaflet'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'

const DEFAULT_CENTER: [number, number] = [42.05035, 12.61569]
const DEFAULT_ZOOM = 13
const SINGLE_PIN_ZOOM = 15
const USER_LOCATION_ZOOM = 15

let iconConfigured = false

function configureDefaultMarkerIcon(): void {
  if (iconConfigured) {
    return
  }

  delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl

  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  })

  iconConfigured = true
}

configureDefaultMarkerIcon()

export interface MapPin {
  id: string
  slug: string
  lat: number
  lng: number
}

interface InteractiveMapProps {
  pins: MapPin[]
  initialCenter?: [number, number]
  initialZoom?: number
  showUserLocationControl?: boolean
  renderPinPopup?: (pin: MapPin) => ReactNode
  onPinClick?: (pin: MapPin) => void
}

type GeoStatus = 'idle' | 'locating' | 'denied' | 'unsupported' | 'error'

interface ViewportControllerProps {
  pins: MapPin[]
  fallbackCenter: [number, number]
  fallbackZoom: number
}

function ViewportController({ pins, fallbackCenter, fallbackZoom }: ViewportControllerProps) {
  const map = useMap()

  useEffect(() => {
    if (pins.length === 0) {
      map.setView(fallbackCenter, fallbackZoom)
      return
    }

    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], SINGLE_PIN_ZOOM)
      return
    }

    const bounds = L.latLngBounds(pins.map((pin) => [pin.lat, pin.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [36, 36] })
  }, [fallbackCenter, fallbackZoom, map, pins])

  return null
}

function FlyToUserLocation({ userLocation }: { userLocation: [number, number] | null }) {
  const map = useMap()

  useEffect(() => {
    if (!userLocation) {
      return
    }

    map.flyTo(userLocation, USER_LOCATION_ZOOM, { duration: 0.8 })
  }, [map, userLocation])

  return null
}

export function InteractiveMap({
  pins,
  initialCenter = DEFAULT_CENTER,
  initialZoom = DEFAULT_ZOOM,
  showUserLocationControl = true,
  renderPinPopup,
  onPinClick,
}: InteractiveMapProps) {
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle')
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)

  const center = useMemo<LatLngExpression>(() => initialCenter, [initialCenter])

  const handleLocateUser = () => {
    if (!navigator.geolocation) {
      setGeoStatus('unsupported')
      return
    }

    setGeoStatus('locating')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation([position.coords.latitude, position.coords.longitude])
        setGeoStatus('idle')
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGeoStatus('denied')
          return
        }

        setGeoStatus('error')
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    )
  }

  return (
    <section aria-label="Mappa interattiva" className="interactive-map-shell">
      <div className="interactive-map-toolbar">
        <p className="interactive-map-title">Mappa interattiva</p>

        {showUserLocationControl && (
          <button
            className="interactive-map-locate"
            disabled={geoStatus === 'locating'}
            onClick={handleLocateUser}
            type="button"
          >
            {geoStatus === 'locating' ? 'Ricerca posizione...' : 'Mostra la mia posizione'}
          </button>
        )}
      </div>

      <MapContainer center={center} className="interactive-map-canvas" scrollWheelZoom zoom={initialZoom}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ViewportController fallbackCenter={initialCenter} fallbackZoom={initialZoom} pins={pins} />
        <FlyToUserLocation userLocation={userLocation} />

        {pins.map((pin) => (
          <Marker
            eventHandlers={
              onPinClick
                ? {
                  click: () => {
                    onPinClick(pin)
                  },
                }
                : undefined
            }
            key={pin.id}
            position={[pin.lat, pin.lng]}
          >
            <Popup>
              {renderPinPopup ? (
                renderPinPopup(pin)
              ) : (
                <div className="interactive-map-popup">
                  <p>{pin.slug}</p>
                </div>
              )}
            </Popup>
          </Marker>
        ))}

        {userLocation && (
          <>
            <Circle
              center={userLocation}
              pathOptions={{
                color: '#3e6e8f',
                fillColor: '#6298bd',
                fillOpacity: 0.24,
              }}
              radius={55}
            />
            <Marker position={userLocation}>
              <Popup>La tua posizione stimata</Popup>
            </Marker>
          </>
        )}
      </MapContainer>

      {pins.length === 0 && (
        <p className="interactive-map-message">Nessun punto disponibile al momento.</p>
      )}

      {geoStatus === 'unsupported' && (
        <p className="interactive-map-message interactive-map-message-error">
          Geolocalizzazione non supportata dal browser.
        </p>
      )}

      {geoStatus === 'denied' && (
        <p className="interactive-map-message interactive-map-message-error">
          Permesso posizione negato. Abilitalo nelle impostazioni del browser.
        </p>
      )}

      {geoStatus === 'error' && (
        <p className="interactive-map-message interactive-map-message-error">
          Impossibile recuperare la posizione. Riprova tra poco.
        </p>
      )}
    </section>
  )
}
