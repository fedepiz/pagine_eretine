import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LatLngExpression } from 'leaflet'
import L from 'leaflet'
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'

const DEFAULT_CENTER: [number, number] = [42.05035, 12.61569]
const DEFAULT_ZOOM = 13
const SINGLE_PIN_ZOOM = 15
const USER_LOCATION_ZOOM = 15
const PAGE_PIN_ICON = L.divIcon({
  className: 'map-pin map-pin-page',
  iconAnchor: [8, 8],
  iconSize: [16, 16],
  popupAnchor: [0, -10],
})
const USER_PIN_ICON = L.divIcon({
  className: 'map-pin map-pin-user',
  iconAnchor: [8, 8],
  iconSize: [16, 16],
  popupAnchor: [0, -10],
})

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

function FlyToUserLocation({
  userLocation,
  focusNonce,
}: {
  userLocation: [number, number] | null
  focusNonce: number
}) {
  const map = useMap()
  const latestLocationRef = useRef<[number, number] | null>(userLocation)

  useEffect(() => {
    latestLocationRef.current = userLocation
  }, [userLocation])

  useEffect(() => {
    if (focusNonce === 0 || !latestLocationRef.current) {
      return
    }

    map.flyTo(latestLocationRef.current, USER_LOCATION_ZOOM, { duration: 0.8 })
  }, [focusNonce, map])

  return null
}

export function InteractiveMap({
  pins,
  initialCenter = DEFAULT_CENTER,
  initialZoom = DEFAULT_ZOOM,
  showUserLocationControl = true,
  renderPinPopup,
}: InteractiveMapProps) {
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle')
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [userLocationFocusNonce, setUserLocationFocusNonce] = useState(0)

  const center = useMemo<LatLngExpression>(() => initialCenter, [initialCenter])

  const requestUserLocation = useCallback((mode: 'silent' | 'manual') => {
    if (!navigator.geolocation) {
      if (mode === 'manual') {
        setGeoStatus('unsupported')
      }

      return
    }

    if (mode === 'manual') {
      setGeoStatus('locating')
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation([position.coords.latitude, position.coords.longitude])
        setGeoStatus('idle')

        if (mode === 'manual') {
          setUserLocationFocusNonce((value) => value + 1)
        }
      },
      (error) => {
        if (mode === 'silent') {
          return
        }

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
  }, [])

  const handleLocateUser = () => {
    if (userLocation) {
      setGeoStatus('idle')
      setUserLocationFocusNonce((value) => value + 1)
      return
    }

    requestUserLocation('manual')
  }

  useEffect(() => {
    if (!showUserLocationControl || !('permissions' in navigator)) {
      return
    }

    let cancelled = false

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((permissionStatus) => {
        if (cancelled || permissionStatus.state !== 'granted') {
          return
        }

        requestUserLocation('silent')
      })
      .catch(() => {
      })

    return () => {
      cancelled = true
    }
  }, [requestUserLocation, showUserLocationControl])

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
        <FlyToUserLocation focusNonce={userLocationFocusNonce} userLocation={userLocation} />

        {pins.map((pin) => (
          <Marker icon={PAGE_PIN_ICON} key={pin.id} position={[pin.lat, pin.lng]}>
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
                color: '#6d8d7a',
                fillColor: '#9ab6a5',
                fillOpacity: 0.24,
              }}
              radius={55}
            />
            <Marker icon={USER_PIN_ICON} position={userLocation}>
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
