# PWA Deployment Notes

## 1) Host frontend on HTTPS
Use Firebase Hosting / Netlify / Vercel.

## 2) Include in your hosted `index.html`
```html
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#116466">
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js');
  });
}
</script>
```

## 3) Keep Apps Script as API proxy/backend bridge
Your current `Code.gs` handles backend calls and access verification.

## 4) Verification rule
- `GET /auth/verify-access?email=user@domain.com`
- Return JSON:
```json
{
  "verified": true,
  "canEnterData": true,
  "canViewAnalytics": true,
  "role": "teacher",
  "reason": ""
}
```

If `canEnterData` is false, UI stays read-only.

## 5) Security reminder
Always enforce permissions in backend endpoints too (not frontend only).
