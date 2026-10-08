# TFAA Stipend Survey Dashboard

The member-facing dashboard for the TFAA stipend survey, published with GitHub Pages at
https://timlinley.github.io/tfaa-stipend-dashboard/

- `index.html` is the dashboard. It holds no survey data: results load from a data feed on the survey owner's Google account each time the page opens.
- `transform.js` turns the raw survey answers from the feed into the tables the dashboard draws (latest response per district, 187-day conversion for extra days, outlier checks, content-area tagging).
- `apps-script/Code.gs` is the data feed. It runs on the responses Sheet as a Google Apps Script web app and sends the answers without submitter names or emails. Archiving that deployment switches the dashboard off. While `REQUIRE_SIGN_IN` is on, it only answers visitors who signed in with Google on the dashboard and whose email is on the Sheet's Testers tab (column A, one email per row; `@domain.org` admits a whole domain). Visitors who can't use Google can ask for a 6-digit code by email instead; codes only go to addresses on the same Testers tab, last 10 minutes, and give an 8-hour sign-in.
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
