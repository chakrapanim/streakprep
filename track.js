// StreakPrep click-stream telemetry. Self-hosted (no third-party analytics) —
// posts to /api/track, which writes to the `events` table in D1.
// anon_id persists per-browser from first visit, independent of login state,
// so pre-registration funnel steps (landing view, CTA click) are still traceable.
(function () {
  function getAnonId() {
    var id = localStorage.getItem('sp_anon_id');
    if (!id) {
      id = 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem('sp_anon_id', id);
    }
    return id;
  }

  window.track = function (eventName, props) {
    try {
      var payload = JSON.stringify({
        event_name: eventName,
        anon_id: getAnonId(),
        props: props || {},
        path: location.pathname,
        referrer: document.referrer || null,
      });
      var session = localStorage.getItem('sp_session');

      // No session yet (pre-login funnel steps): sendBeacon survives page
      // navigation/unload without needing custom headers.
      if (!session && navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
        return;
      }

      var headers = { 'content-type': 'application/json' };
      if (session) headers['Authorization'] = 'Bearer ' + session;
      fetch('/api/track', { method: 'POST', keepalive: true, headers: headers, body: payload })
        .catch(function () {});
    } catch (e) {
      // Telemetry must never break the app.
    }
  };
})();
