# TFAA Stipend Survey Dashboard

The member-facing dashboard for the TFAA stipend survey, published with GitHub Pages at
https://timlinley.github.io/tfaa-stipend-dashboard/

- `index.html` is the dashboard. It holds no survey data: results load from a data feed on the survey owner's Google account each time the page opens.
- `embed.js` puts the dashboard on another site (the TFAA members area) in a frame that resizes to fit, so visitors scroll the page rather than a box.

## Embedding

```html
<div id="tfaa-stipend-dashboard"></div>
<script src="https://timlinley.github.io/tfaa-stipend-dashboard/embed.js" async></script>
```

If the host site does not allow scripts, a plain frame also works:

```html
<iframe src="https://timlinley.github.io/tfaa-stipend-dashboard/" title="TFAA Stipend Survey Dashboard" style="width:100%;height:1800px;border:0"></iframe>
```

Never commit survey responses, names, emails, passwords or keys to this repository.
