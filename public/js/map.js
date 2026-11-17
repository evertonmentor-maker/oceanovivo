/*
 * Adaptador de mapa: usa o Google Maps quando há GOOGLE_MAPS_API_KEY configurada
 * e cai para o OpenStreetMap (Leaflet) quando não há chave ou ela é recusada.
 */
(function () {
  'use strict';

  const SC_CENTER = { lat: -27.35, lng: -48.55 };
  const SC_ZOOM = 8;

  const GOOGLE_STYLES = [
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#a9e4ea' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#0a4d68' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f3f6f2' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e3ecec' }] },
  ];

  function popupHtml(beach) {
    const st = OV.STATUS[OV.statusOf(beach)];
    const last = beach.ultimoBoletim;
    return `<div class="iw">
      <strong>${OV.escapeHtml(beach.nome)}</strong>
      <small>${OV.escapeHtml(beach.municipio)}${last ? ' · coleta ' + OV.formatDate(last.data) : ''}</small>
      <span class="badge ${OV.statusOf(beach)}">${st.label}</span><br>
      <button class="btn btn-dark btn-sm" data-open-beach="${OV.escapeHtml(beach.id)}">Ver detalhes</button>
    </div>`;
  }

  // ---------------- Google Maps ----------------
  function googleProvider(key) {
    let map, info;
    const markers = new Map();

    return {
      name: 'google',
      async init(el) {
        await new Promise((resolve, reject) => {
          window.__ovGmapsReady = resolve;
          OV.loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__ovGmapsReady&loading=async`).catch(reject);
        });
        map = new google.maps.Map(el, {
          center: SC_CENTER, zoom: SC_ZOOM, styles: GOOGLE_STYLES,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
        });
        info = new google.maps.InfoWindow();
      },
      setMarkers(beaches, onOpen) {
        markers.forEach((m) => m.setMap(null));
        markers.clear();
        beaches.forEach((b) => {
          const marker = new google.maps.Marker({
            position: { lat: b.lat, lng: b.lng }, map, title: b.nome,
            icon: {
              path: google.maps.SymbolPath.CIRCLE, scale: 9,
              fillColor: OV.STATUS[OV.statusOf(b)].color, fillOpacity: 1,
              strokeColor: '#ffffff', strokeWeight: 2.5,
            },
          });
          marker.addListener('click', () => {
            info.setContent(popupHtml(b));
            info.open({ map, anchor: marker });
            onOpen && onOpen(b, false);
          });
          markers.set(b.id, marker);
        });
      },
      focus(beach) {
        const marker = markers.get(beach.id);
        map.panTo({ lat: beach.lat, lng: beach.lng });
        if (map.getZoom() < 12) map.setZoom(12);
        if (marker) { info.setContent(popupHtml(beach)); info.open({ map, anchor: marker }); }
      },
      destroy() { markers.forEach((m) => m.setMap(null)); },
    };
  }

  // ---------------- Leaflet / OpenStreetMap ----------------
  function leafletProvider() {
    let map;
    const markers = new Map();

    return {
      name: 'leaflet',
      async init(el) {
        OV.loadCss('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css');
        await OV.loadScript('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js');
        el.innerHTML = '';
        map = L.map(el, { scrollWheelZoom: false }).setView([SC_CENTER.lat, SC_CENTER.lng], SC_ZOOM);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        map.on('focus', () => map.scrollWheelZoom.enable());
        map.on('blur', () => map.scrollWheelZoom.disable());
      },
      setMarkers(beaches, onOpen) {
        markers.forEach((m) => m.remove());
        markers.clear();
        beaches.forEach((b) => {
          const m = L.circleMarker([b.lat, b.lng], {
            radius: 9, color: '#fff', weight: 2.5, fillColor: OV.STATUS[OV.statusOf(b)].color, fillOpacity: 1,
          }).addTo(map).bindPopup(popupHtml(b));
          m.on('click', () => onOpen && onOpen(b, false));
          markers.set(b.id, m);
        });
      },
      focus(beach) {
        map.setView([beach.lat, beach.lng], Math.max(map.getZoom(), 12));
        const m = markers.get(beach.id);
        if (m) m.openPopup();
      },
    };
  }

  // ---------------- Fábrica ----------------
  window.OVMap = {
    /**
     * onFallback() é chamado quando o OpenStreetMap é usado no lugar do Google.
     * onReplace(provider) é chamado se o Google recusar a chave depois de carregado.
     */
    async create(el, { googleMapsApiKey, onFallback, onReplace } = {}) {
      const useLeaflet = async () => {
        const provider = leafletProvider();
        await provider.init(el);
        onFallback && onFallback();
        return provider;
      };
      if (googleMapsApiKey) {
        const provider = googleProvider(googleMapsApiKey);
        // Chamado pelo Google quando a chave é inválida ou o domínio não está autorizado.
        window.gm_authFailure = async () => {
          console.warn('Chave do Google Maps recusada, usando OpenStreetMap.');
          provider.destroy();
          onReplace && onReplace(await useLeaflet());
        };
        try {
          await provider.init(el);
          return provider;
        } catch (e) {
          console.warn('Google Maps indisponível, usando OpenStreetMap.', e);
        }
      }
      return useLeaflet();
    },
  };
})();
