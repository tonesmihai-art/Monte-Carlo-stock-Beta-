# Monte Carlo Stocks — PWA

Simulare Monte Carlo pentru actiuni cu analiza sentiment din Yahoo Finance, Reuters si Google News.

## 📁 Structura

```
monte-carlo-pwa/
├── index.html          ← pagina principala
├── manifest.json       ← PWA manifest
├── sw.js               ← Service Worker (offline)
├── css/
│   └── style.css
├── js/
│   ├── app.js          ← orchestrare principala
│   ├── montecarlo.js   ← simulare GBM (50.000 scenarii)
│   ├── sentiment.js    ← analiza stiri + VADER
│   └── charts.js       ← grafice Chart.js
└── icons/
    ├── icon-192.png    ← genereaza cu orice editor
    └── icon-512.png
```

## 🚀 Deploy pe GitHub Pages

1. Creeaza un repo nou pe GitHub (ex: `monte-carlo-stocks`)
2. Incarca toate fisierele (drag & drop pe GitHub sau `git push`)
3. Mergi la **Settings → Pages → Source → Deploy from branch → main / (root)**
4. Dupa ~60 secunde, aplicatia e live la:
   `https://[username].github.io/[repo-name]/`
5. Pe telefon: deschide URL-ul → browser-ul iti va oferi optiunea **"Adauga pe ecranul principal"**

## 🛠 Testare locala

Nu poti deschide direct `index.html` (module ES6 necesita server).
Foloseste un server local:

```bash
# Python (recomandat)
python -m http.server 8080
# apoi deschide http://localhost:8080

# sau Node.js
npx serve .
```

## 📌 Iconite PWA

Genereaza iconitele `icon-192.png` si `icon-512.png` folosind orice editor
(paint, figma, canva) sau un generator online:
https://favicon.io/favicon-generator/

Pune-le in folderul `icons/`.

## ⚙️ Functioneaza fara API key

- **Date actiuni**: Yahoo Finance (public, via corsproxy.io)
- **Stiri**: RSS feeds publice (Yahoo Finance, Reuters, Google News) via rss2json.com
- **Sentiment**: VADER implementat local in JavaScript
- **Offline**: Service Worker cacheuieste aplicatia dupa prima vizita

## ⚠️ Disclaimer

Simulare matematica, nu sfat financiar.

<img width="1080" height="1350" alt="WhatsApp Image 2026-04-27 at 07 29 18" src="https://github.com/user-attachments/assets/253fa0e7-6bf2-4f72-9dbb-b6d9abc2c8cf" />

