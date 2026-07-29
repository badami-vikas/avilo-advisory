/**
 * The login screen.
 *
 * Served by the API rather than built into the React bundle, and deliberately: the app
 * cannot render until it can read data, and it cannot read data until you have signed
 * in. A plain form with no scripts and no assets breaks that circle, and keeps working
 * when the bundle is the thing that has failed to load.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function loginPage(error: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Avilo Advisory</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #f6f7f9; color: #16181d;
    font: 400 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { width: 100%; max-width: 340px; padding: 24px; }
  h1 { margin: 0; font-size: 17px; letter-spacing: -0.01em; }
  p.sub { margin: 4px 0 20px; font-size: 12.5px; color: #6b7280; }
  form { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; }
  label { display: block; font-size: 11px; font-weight: 600; letter-spacing: .06em;
          text-transform: uppercase; color: #6b7280; margin-bottom: 6px; }
  input {
    width: 100%; padding: 9px 11px; font-size: 14px; font-family: inherit;
    border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: inherit;
  }
  input:focus { outline: 2px solid #1570ef; outline-offset: -1px; border-color: #1570ef; }
  button {
    width: 100%; margin-top: 12px; padding: 9px 12px; font: inherit; font-weight: 600;
    color: #fff; background: #1570ef; border: 0; border-radius: 8px; cursor: pointer;
  }
  button:hover { background: #1160cf; }
  .error {
    margin: 0 0 12px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px;
    color: #b42318; background: #fef3f2; border: 1px solid #fecdca;
  }
  footer { margin-top: 14px; font-size: 11.5px; color: #9ca3af; text-align: center; }
</style>
</head>
<body>
<main>
  <h1>Avilo Advisory</h1>
  <p class="sub">This workspace holds client financial records.</p>
  <form method="post" action="/auth/login">
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <label for="password">Passphrase</label>
    <input id="password" name="password" type="password" autocomplete="current-password"
           autofocus required>
    <button type="submit">Sign in</button>
  </form>
  <footer>One shared passphrase — there are no individual accounts.</footer>
</main>
</body>
</html>`;
}
