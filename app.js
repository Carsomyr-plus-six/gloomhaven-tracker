// A stand-in for a page cached from before the code moved into campaign/
// and app/: that page's index.html loads campaign.js (now empty) and this
// file, so this loads the files today's index.html lists, in its order.
// Can go once no browser could still hold a page from before the move
// (GitHub Pages lets one keep it 10 minutes).
(() => {
  const here = document.currentScript.src;
  (async () => {
    const page = new URL("index.html", here);
    const html = await (await fetch(page, { cache: "no-cache" })).text();
    for (const [, src] of html.matchAll(/<script src="((?:campaign|app)\/[\w-]+\.js)"/g)) {
      const script = document.createElement("script");
      script.src = new URL(src, page).href;
      script.async = false;   // run in the order listed
      document.head.append(script);
    }
  })();
})();
