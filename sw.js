const CACHE_NAME = 'personalpro-v1'
const SUPABASE_HOST = 'kdmcaksypdjsnwufkxng.supabase.co'

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/logo.png.png',
  '/manifest.json'
]

self.addEventListener('install', event => {
  console.log('[SW] Instalando…')
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => console.log('[SW] Assets estáticos em cache'))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  console.log('[SW] Ativando…')
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => {
            console.log('[SW] Removendo cache antigo:', k)
            return caches.delete(k)
          })
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event

  // Não intercepta requisições que não sejam GET (POST, PATCH, DELETE…)
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Network First para Supabase
  if (url.hostname === SUPABASE_HOST) {
    event.respondWith(networkFirst(request))
    return
  }

  // Cache First para assets do próprio app
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request))
    return
  }

  // Network First com fallback para CDNs e demais origens
  event.respondWith(networkFirst(request))
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) {
    console.log('[SW] Cache ➜', request.url)
    return cached
  }
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) {
      console.log('[SW] Offline, cache ➜', request.url)
      return cached
    }
    const isApi = new URL(request.url).hostname === SUPABASE_HOST
    return new Response(
      isApi ? JSON.stringify({ error: 'offline' }) : 'Offline',
      {
        status: 503,
        headers: { 'Content-Type': isApi ? 'application/json' : 'text/plain' }
      }
    )
  }
}
