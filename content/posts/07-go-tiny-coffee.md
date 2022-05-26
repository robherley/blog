---
title: "☕ Rewriting tiny.coffee to < 100 lines of Go"
date: 2022-03-06T00:00:00-05:00
draft: false
tags:
  - golang
  - http
  - curl
  - container
---

## History of tiny.coffee

There are people in this world that suffer from an incredible problem -- the **unresistable urge** to buy vanity domains. I am one of those people, and one of favorites (excluding my brief ownership of `ibm.lol`)[^1] is [tiny.coffee](https://tiny.coffee).

[^1]: Unfortunately had to release `ibm.lol` after NameCheap forwarded me a letter from IBM IP Law Department. I didn't want to lose my job at the time 😅

At first I didn't know _what_ I wanted to do with it, but then I was inspired by [parrot.live](https://github.com/hugomd/parrot.live)! When running `curl parrot.live`, you will be greeted with a ASCII party parrot in your terminal:

![parrot live screenshot](/content/tiny.coffee/parrot.png "Example of `curl parrot.live`")

I decided to [fork it](https://github.com/robherley/tiny.coffee/commit/fe46c464d1ab3ae7435b36e6cdca0f8b3d61717c) into `tiny.coffee`. It just required a few HTML and ASCII changes, the JavaScript code was practically identical and didn't need major tweaks. After adding a Dockerfile, it was deployed!

Although, my ASCII art left a lot to be desired:

![old tiny coffee screenshot](/content/tiny.coffee/coffee-old.png "Example of v1 `curl tiny.coffee`")

If a user made a request via a web browser (or anything else without `curl` in the user agent), it would respond with a simple HTML webpage with a tiny party parrot holding coffee.

![old tiny coffee web](/content/tiny.coffee/coffee-old-web.png "Old tiny.coffee web page")


## Aging like milk

The first version of `tiny.coffee` was deployed ~4 years ago and a bit has changed since then. It's been moved from more machines/clouds than I can count. Most recently it was just a static site hosted on Vercel without the special curl user agent code path. This was meant to be temporary, but changing apartments/jobs and countless homelab rebuilds left it in limbo.

So, with my now ["stable" homelab](/posts/01-homelab-pt1/), I decide to spin it up again. I was quickly greeted by a familar site for JS devs:

```text
npm WARN old lockfile
npm WARN old lockfile The package-lock.json file was created with an old version of npm,
npm WARN old lockfile so supplemental metadata must be fetched from the registry.
npm WARN old lockfile
npm WARN old lockfile This is a one-time fix-up, please be patient...
npm WARN old lockfile
npm WARN deprecated fsevents@1.2.4: fsevents 1 will break on node v14+ and could be using insecure binaries. Upgrade to fsevents 2.
npm WARN deprecated set-value@2.0.0: Critical bug fixed in v3.0.1, please upgrade to the latest version.
npm WARN deprecated ini@1.3.5: Please update to ini >=1.3.6 to avoid a prototype pollution issue
npm WARN deprecated set-value@0.4.3: Critical bug fixed in v3.0.1, please upgrade to the latest version.
npm WARN deprecated urix@0.1.0: Please see https://github.com/lydell/urix#deprecated
npm WARN deprecated resolve-url@0.2.1: https://github.com/lydell/resolve-url#deprecated
npm WARN deprecated source-map-url@0.4.0: See https://github.com/lydell/source-map-url#deprecated
npm WARN deprecated chokidar@2.0.4: Chokidar 2 does not receive security updates since 2019. Upgrade to chokidar 3 with 15x fewer dependencies
npm WARN deprecated debug@3.2.6: Debug versions >=3.2.0 <3.2.7 || >=4 <4.3.1 have a low-severity ReDos regression when used in a Node.js environment. It is recommended you upgrade to 3.2.7 or 4.3.1. (https://github.com/visionmedia/debug/issues/797)
npm WARN deprecated mixin-deep@1.3.1: Critical bug fixed in v2.0.1, please upgrade to the latest version.
npm WARN deprecated source-map-resolve@0.5.2: See https://github.com/lydell/source-map-resolve#deprecated
```

The deprecation warnings have deprecation warnings. And even better:

```text
added 229 packages, and audited 230 packages in 8s

19 vulnerabilities (1 low, 8 moderate, 9 high, 1 critical)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
```

This is why [Snyk](https://snyk.io/) and [Dependabot](https://github.com/dependabot) are so popular in the JS community. Even an app as simple as this with only two immediate dependencies links to over 200 packages with 19 vulnerabilites (with a critical and multiple high)!

{{< terminal >}}
# listing npm dependencies
rob@mbp$ cat package.json | jq '.dependencies'
{
  "colors": "1.1.2",
  "mz": "2.7.0"
}

# size of npm dependencies
rob@mbp$ du -h node_modules
7.1M	node_modules

# how many files of npm dependencies
rob@mbp$ find node_modules -type f | wc -l
    1271
{{< /terminal >}}

And yes, many may argue both of these dependencies can be removed:
- `colors` can be replaced by [ANSI escape sequences](https://tldp.org/HOWTO/Bash-Prompt-HOWTO/x329.html). Still has [24.8M weekly downloads](https://www.npmjs.com/package/colors) on NPM at the time of writing this.
- `mz` isn't nessary anymore in modern Node versions since we have [`fs/promises`](https://nodejs.org/api/fs.html#promises-api) and [`util.promisify`](https://nodejs.org/api/util.html#utilpromisifyoriginal). Still has [3.8M weekly downloads](https://www.npmjs.com/package/mz) on NPM at the time of writing this.

Instead of patching these dependencies, I figured it'd be a fun afternoon project to rewrite this in Go!

## The rewrite

To me, Go was a perfect replacement. It has a great HTTP server in the [`net/http`](https://pkg.go.dev/net/http) standard library and the static content (HTML & ASCII art) can actually be embeded in the binary directly using [`embed`](https://pkg.go.dev/embed) in Go >= 1.16. Everything required is already in the standard library, which means no dependencies!

### Embedding static files

This can't be easier. To "embed" a static file into the Go binary, it just needs a brief `//go:embed` comment above the variable, and it will contain the specified data at runtime:

```go
var (
  //go:embed static/index.html
  indexHTML []byte // binary content of the index.html

  //go:embed frames/*.txt
  frameFS embed.FS // read-only filesystem containing ASCII coffee frames

  //...
)
```

Now, the compiled binary can be moved around without depending on a specific folder structure/path.

### Serving the coffee

I'll be using the default router in the `net/http` package and adding a single route to handle all requests. It will follow this pattern:

{{< mermaid >}}
%%{init: {'theme': 'dark' } }%%
stateDiagram-v2
    state ua <<choice>>
    new_req: new request
    stream: streaming
    frame: send frame
    html: render html
    timeout: 2min timeout
    user_close: user closed conn

    new_req --> ua
    ua --> stream: user-agent = curl
    ua --> html: user-agent = *

    stream --> frame: every 100ms
    frame --> stream

    stream --> timeout
    stream --> user_close

    timeout --> [*]
    user_close --> [*]
{{< /mermaid >}}

Nothing too complicated going on here, this can be contained to a `for...select` block with a couple channels. To account for both the user closing the connection and the two minute timeout, the default [`Request.Context`](https://pkg.go.dev/net/http#Request.Context) can be wrapped in the [`context.WithTimeout`](https://pkg.go.dev/context#WithTimeout) and those cases can be handled together in a single channel. Otherwise, a [`time.Ticker`](https://pkg.go.dev/time#Ticker) will be used to send ANSI codes and a ASCII coffee frame every 100ms.

```go
idx := 0
ticker := time.NewTicker(time.Millisecond * 100)
reqCancelCtx, cancel := context.WithTimeout(r.Context(), time.Minute * 2)
defer cancel()

for {
  select {
  case <-reqCancelCtx.Done():
    w.Write([]byte("no more coffee :(\n"))
    return
  case <-ticker.C:
    w.Write(ansiClear)
    w.Write(ansiColors[idx%len(ansiColors)])
    w.Write(frames[idx%len(frames)])
    w.Write(ansiReset)
    if f, ok := w.(http.Flusher); ok {
      f.Flush()
    }
    idx = idx + 1
  }
}
```

Note the `f.Flush()`, the default `http.Transport` in Go has a [default write buffer size of 4KB](https://cs.opensource.google/go/go/+/refs/tags/go1.17.8:src/net/http/transport.go;l=262-265), so the response writer will need to be flushed in order to get the coffee pouring in a timely matter.

### Fresh coat of paint

My original ASCII art was horrible and the coffee mug was quite large for a _tiny coffee_, so I found some nice ASCII from [ascii-art.de](http://www.ascii-art.de/ascii/c/coffee.txt) and slightly modified the "Double Espresso" from an unknown author.

![new tiny coffee](/content/tiny.coffee/coffee-new.png "New output of `curl tiny.coffee`")


The HTML also needed some sprucing up. I wanted to publicize the main attraction, so slapping `curl tiny.coffee` in the center of the page with a link to the source code under it seemed appropriate. Finally, making the original coffee party parrot bounce around like a mid-2000s DVD screensaver was the icing on the cake.

![new tiny coffee web](/content/tiny.coffee/coffee-new-web.png "New tiny.coffee web page")

## Bonus: Containerization and CI/CD

Static Go binaries are great, but they're only portable to their target architecture/OS. It'd be great to automatically build and push a container image. With about ~50 lines of YAML this can be automated with GitHub Actions.

For the container itself, I'll be using the base debian variant of [Google's distroless container images](https://github.com/GoogleContainerTools/distroless). [Here's the Dockerfile](https://github.com/robherley/tiny.coffee/blob/eebe8913e8094d44e3f29edd1e1f86d16bbe4c2f/Dockerfile).

When a tag is pushed, the workflow will:

1. Create a new release via [`actions/github-script@v5`](https://github.com/actions/github-script) with a tag from the git ref (ie: `vX.Y.Z`) and set it as an output.
2. Login to GitHub container registry.
3. Extract image metadata from environment variables.
4. Build and push the image with the tag from Step 1.

The workflow is [defined here](https://github.com/robherley/tiny.coffee/blob/72508ec67d139d3a19a04a70d5893f1260f6ff71/.github/workflows/ci.yaml), and the container image can be [found here](https://github.com/robherley/tiny.coffee/pkgs/container/tiny.coffee).

To run it locally, you can use `podman` or `docker`:

{{< terminal >}}
rob@mbp$ podman run -p 8000:8000 ghcr.io/robherley/tiny.coffee
2022/03/07 04:24:53 serving coffee on: 0.0.0.0:8000
{{< /terminal >}}

And that's it! Enjoy your coffee ☕
