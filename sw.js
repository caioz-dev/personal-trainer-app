// Kill-switch: o app NÃO usa service worker. Este arquivo existe só para substituir o sw.js
// antigo (cache-first, jun–jul/2026) que ficou registrado em alguns navegadores e entrega o
// HTML de julho a cada abertura. O navegador busca /sw.js sozinho ao navegar, instala esta
// versão, que apaga os caches, se desregistra e recarrega as abas que o SW antigo
// controlava — agora direto da rede. Não tem handler de fetch, então não intercepta nada.
// Não remover enquanto houver chance de algum navegador ainda ter o SW antigo.

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    } catch {}
    // Desregistra antes de recarregar: navegação de um registro em desinstalação não passa
    // mais pelo SW, então as abas voltam com o HTML da rede (que não registra SW nenhum).
    try { await self.registration.unregister() } catch {}
    try {
      // Só as abas controladas por este registro (as que estavam no HTML antigo); abas
      // abertas com Ctrl+Shift+R não são controladas e ficam intactas.
      const clients = await self.clients.matchAll({ type: 'window' })
      await Promise.all(clients.map(c => c.navigate(c.url).catch(() => null)))
    } catch {}
  })())
})
