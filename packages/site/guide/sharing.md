# Sharing

Two ways show results to people who have no account: a **share link** for one run, and a **public status page** for the packs you choose. Both are read-only. Nobody who opens them can start, change or delete anything.

## Share links

On a run's page, press **Share**. Choose how long the link works (1, 7 or 30 days, or until you take it back) and press **Make a link**, then copy it. Every link that still works can be copied again later, from the Share box or from **Settings › Sharing**.

Anyone with the link sees the run's results, errors, screenshots, videos and files, without signing in, and what the run page shows of each attempt: its metrics, its texts (`h.text`; Markdown ones rendered) and its review scores and notes. When the pack has a [dashboard](./dashboards), the page starts with its public tiles for that one run: its metric values, mean scores, the param values it ran with. A run that is still going updates by itself.

- **Traces and network files stay private** unless you turn on **Include traces and network files**. A Playwright trace and the network files a run collected can hold cookies and tokens the site set, so share them only with people who need them.
- **Reviewers show as "Reviewer 1", "Reviewer 2"** unless you turn on **Show reviewers' names**.
- **What a pack never shares.** A pack's [`share` block](./dashboards#keeping-things-out-of-shares) keeps its texts, metrics, reviews or named outputs out of every share link and the status page.
- **Take a link back** in the Share box on the run's page, or in **Settings › Sharing**, which lists every link that still works, who made it and how often it was opened. A link stops working at once when it is taken back, when it expires, or when its run is deleted.
- **Who can make one.** With [login](./safety#login) on, people with the user or admin role. Viewers can't.

A link uses the address you opened Watchwright at. When that is `127.0.0.1` or `localhost`, the link works only on your own computer: open Watchwright at the address other people use, or start it with [`--public-url`](../reference/cli#serve).

Without login, anyone who can reach the server already sees everything, so a share link adds nothing there except a page with only that run on it.

## Public status page

An admin can turn on a status page at `#/status` in **Settings › Sharing**:

1. Turn on **Public status page**.
2. Under **Packs shown**, pick the packs it shows, and give the page a title.
3. Save.

For each pack the page shows how its latest run went (passed, failed and broken attempts, when it ran, how long it took) and a row of its last 20 runs, one mark each, colored by how it went. It updates every minute.

With **Packs show their dashboards** on (the default), each pack also shows the public tiles of its [dashboard](./dashboards): a tile with `public: false` never shows, and neither do links or the waiting-for-review tile, which need an account. Tiles that show what runs made (screenshots, outputs, failures, lowest scores) show only while **Runs open read-only** is on.

With **Runs open read-only** on, each run on the page opens like a share link, without traces and network files, and anonymous reviewers. With it off, the page shows only the marks, numbers and tiles.

Anyone who can reach the server can open the page, signed in or not. Put only packs on it whose names and results you don't mind showing.

## Limits

The pages for people without an account answer only for the run or packs they were given: no other run, no list of packs, no file outside what the run recorded. Each address may make 600 requests a minute to them (a video plays in many small requests); past that it gets `429 Too Many Requests` for the rest of the minute.

See [Sharing](../reference/http-api#sharing) in the API.
