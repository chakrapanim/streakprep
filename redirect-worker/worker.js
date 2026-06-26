const TARGET = "https://streakprep.ai";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const destination = new URL(incoming.pathname + incoming.search, TARGET);
    return Response.redirect(destination.toString(), 301);
  },
};
