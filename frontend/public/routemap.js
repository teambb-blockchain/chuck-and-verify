// The batch page's route map: numbered pins for each place the beef was
// (verify-core routeStops), joined in order, with the leg still in transit
// dashed. Leaflet and the map tiles load only once a map scrolls into view,
// so a lookup that never shows the map costs nothing extra.
//
// The numbered list under the map says the same thing in text, which is what
// screen readers get, and it names stops the directory has no location for.

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
const LEAFLET_JS_SRI = "sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==";
const LEAFLET_CSS_SRI = "sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==";

let leafletLoad = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletLoad) {
    leafletLoad = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET + "leaflet.min.css";
      css.integrity = LEAFLET_CSS_SRI;
      css.crossOrigin = "anonymous";
      document.head.append(css);
      const js = document.createElement("script");
      js.src = LEAFLET + "leaflet.min.js";
      js.integrity = LEAFLET_JS_SRI;
      js.crossOrigin = "anonymous";
      js.onload = () => resolve(window.L);
      js.onerror = () => {
        leafletLoad = null;
        js.remove();
        reject(new Error("Map library didn't load"));
      };
      document.head.append(js);
    });
  }
  return leafletLoad;
}

// Straight-line miles between consecutive located stops (haversine).
export function routeMiles(stops) {
  const located = stops.filter((s) => s.located);
  const rad = (d) => (d * Math.PI) / 180;
  let miles = 0;
  for (let i = 1; i < located.length; i++) {
    const a = located[i - 1];
    const b = located[i];
    const h =
      Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    miles += 2 * 3958.8 * Math.asin(Math.sqrt(h));
  }
  return miles;
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function stopName(stop) {
  return stop.name || (stop.pending ? "The receiver" : "A business not in the directory");
}

function pinClass(stop) {
  return "route-pin" + (stop.pending ? " is-pending" : "") + (stop.current ? " is-current" : "");
}

function draw(L, canvas, stops) {
  const located = stops.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.located);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  // On a touch screen the map is a fixed overview, so a finger on it
  // scrolls the page instead of getting stuck panning the map.
  const map = L.map(canvas, {
    scrollWheelZoom: false,
    dragging: !coarse,
    touchZoom: !coarse,
    doubleClickZoom: !coarse,
    boxZoom: !coarse,
    keyboard: !coarse,
    zoomControl: !coarse,
    tap: false,
    attributionControl: true
  });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const points = located.map((s) => [s.lat, s.lng]);
  for (let i = 1; i < located.length; i++) {
    L.polyline([points[i - 1], points[i]], {
      className: "route-line" + (located[i].pending ? " is-pending" : ""),
      interactive: false
    }).addTo(map);
  }
  for (const stop of located) {
    L.marker([stop.lat, stop.lng], {
      icon: L.divIcon({ className: "", html: `<span class="${pinClass(stop)}">${stop.n}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
      title: stop.n + ". " + stopName(stop),
      keyboard: false
    })
      .bindTooltip(
        `<strong>${escapeHtml(stopName(stop))}</strong>` + (stop.city ? `<br>${escapeHtml(stop.city)}` : ""),
        { direction: "top", offset: [0, -14] }
      )
      .addTo(map);
  }
  if (points.length === 1) map.setView(points[0], 9);
  // Extra room on the left keeps pins clear of the zoom buttons.
  else map.fitBounds(points, { paddingTopLeft: [coarse ? 28 : 56, 28], paddingBottomRight: [28, 28], maxZoom: 10 });
  return map;
}

// The map panel's body: the map canvas (drawn when visible) and the stop list.
export function routeBody(stops) {
  const wrap = document.createElement("div");
  wrap.className = "route-body";

  const located = stops.filter((s) => s.located);
  const first = stops[0];
  const last = stops[stops.length - 1];
  const canvas = document.createElement("div");
  canvas.className = "route-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Map of " + stops.length + (stops.length === 1 ? " stop" : " stops") +
      (stops.length > 1 ? ", from " + stopName(first) + " to " + stopName(last) : "") +
      ". The stops are listed below the map."
  );
  wrap.append(canvas);

  const list = document.createElement("ol");
  list.className = "route-stops";
  stops.forEach((stop, i) => {
    const li = document.createElement("li");
    const pin = document.createElement("span");
    pin.className = pinClass(stop);
    pin.setAttribute("aria-hidden", "true");
    pin.textContent = String(i + 1);
    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "route-stop-name";
    name.textContent = stopName(stop);
    const sub = document.createElement("div");
    sub.className = "route-stop-sub";
    const notes = [];
    if (stop.city) notes.push(stop.city);
    if (stop.pending) notes.push("On the way");
    else if (stop.current) notes.push("Has it now");
    if (!stop.located) notes.push("Not on the map: no location on file");
    sub.textContent = notes.join(" · ");
    text.append(name, sub);
    li.append(pin, text);
    list.append(li);
  });
  wrap.append(list);

  const fail = () => {
    canvas.classList.add("is-failed");
    canvas.textContent = "The map couldn't load. The stops are listed below.";
  };

  // Leaflet sizes itself from its container, so draw only once the canvas
  // is actually on screen (the phone and desktop layouts each have one).
  let map = null;
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting) || map) return;
    observer.disconnect();
    map = true;
    loadLeaflet()
      .then((L) => {
        map = draw(L, canvas, stops);
      })
      .catch(fail);
  }, { rootMargin: "200px" });
  if (located.length) observer.observe(canvas);
  else canvas.remove();
  return wrap;
}
