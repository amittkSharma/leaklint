export const CSS = `
body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 1000px; padding: 0 1rem; color: #1f2328; }
h1 { margin: 0; }
h2 { margin-top: 2rem; border-bottom: 1px solid #d0d7de; padding-bottom: .25rem; }
.source { margin: .25rem 0 0; color: #656d76; }
.tiles { display: flex; gap: .75rem; flex-wrap: wrap; margin: 1rem 0; }
.tiles > * { font: inherit; color: inherit; text-align: left; background: #fff; border: 1px solid #d0d7de; border-radius: 6px; padding: .5rem 1rem; }
.tiles b { display: block; font-size: 1.5rem; }
button { cursor: pointer; }
button:hover { background: #f6f8fa; }
button[aria-pressed=true] { border-color: #0969da; box-shadow: 0 0 0 2px #0969da33; }
.hint { margin: 0 0 1rem; color: #656d76; }
[hidden] { display: none !important; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #eaeef2; vertical-align: top; }
code { font: 12px ui-monospace, monospace; }
.error { color: #cf222e; font-weight: 600; }
.warn { color: #9a6700; font-weight: 600; }
.muted { color: #656d76; }
.fix { margin-top: .25rem; color: #1a7f37; }
.fix b { color: #1f2328; }
`;

/** Click a tile, or open the page with #error, #warn or #skipped, to filter. Click again to show everything. */
export const SCRIPT = `
const tiles = [...document.querySelectorAll('button[data-filter]')];

function applyFilter() {
  const filter = location.hash.slice(1);
  const bySeverity = filter === 'error' || filter === 'warn';
  tiles.forEach((tile) => tile.setAttribute('aria-pressed', String(tile.dataset.filter === filter)));
  document.getElementById('findings').hidden = filter === 'skipped';
  document.getElementById('skipped').hidden = bySeverity;
  document.querySelectorAll('tr[data-sev]').forEach((row) => {
    row.hidden = bySeverity && row.dataset.sev !== filter;
  });
  document.querySelectorAll('section.file').forEach((section) => {
    section.hidden = !section.querySelector('tr[data-sev]:not([hidden])');
  });
}

tiles.forEach((tile) =>
  tile.addEventListener('click', () => {
    location.hash = location.hash.slice(1) === tile.dataset.filter ? '' : tile.dataset.filter;
  }),
);
addEventListener('hashchange', applyFilter);
applyFilter();
`;
