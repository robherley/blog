---
title: "✂️ snips.sh retrospective: 1000+ stars later"
date: 2024-10-04T13:50:16-04:00
draft: false
tags:
  - golang
  - terminal
  - ssh
  - sqlite
  - tensorflow
images:
  - /content/snips-retro/preview.png
---

{{< tweet "1657139515557920770" >}}

## What the snip?

A tad bit over a year ago, I released https://snips.sh, a passwordless, anonymous SSH-powered pastebin with a human-friendly TUI and web UI. No logins, no passwords, nothing to install. It's ready-to-go on any machine that has SSH installed.

It's a simple as:

```bash
echo 'this is amazing!' | ssh snips.sh
```

I wanted an easy utility to copy code snippets to/from machines, a dead-simple web UI to link to line numbers and something to just dump code snippets.

And the development community loved it. To my surprise, it rapidly gained popularity across social media. It even made the top of GitHub's [`/trending`](https://github.com/trending) under the Go language category for a couple days.

![stargazers](https://api.star-history.com/svg?repos=robherley/snips.sh&type=Date&theme=dark&size=mobile "Surpassed 1k stars just over a year!")

Given I procrastinated for over a year making an original "release" blog post for snips, I figured a retrospective would be just as good.

## The philosophy

When designing snips, I wanted it to be as _simple_ as possible. If I learned anything from maintaining open source libraries and supporting public APIs used by millions of people, it's important to not bloat with verbose functionality that becomes a maintenance/compatibility nightmare.

I manifested my inner Ken and Dennis and kept the [Unix Philosophy](https://en.wikipedia.org/wiki/Unix_philosophy) top of mind:

> Write programs that do one thing and do it well.  
> Write programs to work together.  
> Write programs to handle text streams, because that is a universal interface.

And that's exactly what snips is.

1. It's a snippet store (with a UI and TUI), nothing more.
2. It works with other command line programs via pipes.
3. The "API" is just text over stdin/stdout.

![pipe examples](/content/snips-retro/pipe.gif "Pipe into whatever you want")

But, this isn't just a command line utility. While I love the Unix Philosophy, it is not my creed. Just as much as I believe simplicity is key in software development, the user experience is just as important. This is often a very hard balance.

Under the covers, snips.sh is a stateful remote resource that requires functionality beyond the simple input/output. And that's what the TUI is for. It's a shell into the user's snips. You can use the TUI to view snips syntax highlighted, edit attributes and delete them.

![tui](/content/snips-retro/ssh.gif "A user can `ssh` into the TUI to view/manage snips")

As a developer building tools for developers, I know how comfortable most are in the terminal, which is why I chose that as the entrypoint over a web UI. They don't even need to lift their fingers off the keyboard.

I also wanted the onboarding experience to be as smooth as possible. Here's how the upload works for a new user:

{{< mermaid >}}
%%{init: {'theme': 'dark' } }%%
flowchart TD
  ssh([ssh session])
  fail((fail))
  onboard((onboard))
  a@{ shape: diamond, label: "auth" }
  pk@{ shape: diamond, label: "exists?" }
  wf((write snip))


  ssh --> a
  a --"password"--> fail
  a --"pubkey"-->pk

  pk --"no"--> onboard
  pk --"yes"--> wf
  onboard --> wf

{{< /mermaid >}}

The usage of snips.sh does require public key auth in order to identify users. If a connection attempt is made with a password, it fails and sends a message to stdout. This also helps prevent against bots and other things that like to poke at port 22.

For any new users, if their public key doesn't exist in the database, we'll "onboard" which will create a new user record and associate a public key with it. A terms of service message is also printed for new users. Since we're able to create a new identity and automatically onboard, there is literally zero friction to get started.

While it's nice to keep things as simple as can be, like anything with software engineering "it depends" on your use case. Personally, I'm a fan of making easy (and fun!) to use software, which might need a few engineering tradeoffs for a better user experience.

As it turns out, people like easy to use software:

{{< tweet "1657456167524917248" >}}

{{< tweet "1657477244158189570" >}}

## The technology

All of snips.sh is written in Go, from the SSH app to the web UI. While Go may not be as creative or fast as other languages, I do find beauty in the simplicity.

As luck might have it, there's also an organization called [Charm](https://charm.sh/) that builds amazing libraries for the command line, all built in Go. So surprise, snips.sh uses [plenty of Charm libraries](https://github.com/robherley/snips.sh/blob/b6c00d501f44ccddbbd323fb4cbaded1124aef5b/go.mod#L9-L13). They're a great group of people, you should totally check them out.

There's no real fancy frameworks in snips.sh. All the web-based routes use the standard library's [`net/http`](https://pkg.go.dev/net/http) server along with the [`html/template`](https://pkg.go.dev/html/template) package for server side rendering. There is about ~120 lines of JavaScript and some old fashioned hand-rolled CSS to keep things as tiny as can be.

As for the backing storage, I went with the most deployed database in the world, SQLite. Why SQLite you ask?
1. It's _really_ fast.[^1]
2. It's stupid simple to use. It's embedded and doesn't need extra resources/configuration.
3. The database is all stored in a single file, making it easy to manage (and [backup](https://litestream.io/)).
4. Some people much smarter than me have been scaling it like crazy.[^2]

While some S3-compatible storage might have been first choice for some, I considered it overkill. Having to run another program or worse (connect to a cloud provider!) I figured the 1MB file size limit would be absolutely fine in a blob column, especially since it's compressed with [zstd](https://facebook.github.io/zstd/) too.

For a lot of the fancy web UI rendering, I have to give credit to some amazing open source libraries:
- [`alecthomas/chroma`](https://github.com/alecthomas/chroma): Syntax Highlighter
- [`yuin/goldmark`](https://github.com/yuin/goldmark): Markdown Parser
- [`microcosm-cc/bluemonday`](https://github.com/microcosm-cc/bluemonday): HTML Sanitizer
- [`tdewolff/minify`](https://github.com/tdewolff/minify): Asset Minifier

And that's pretty much it! Keeping the technology simple means it's just as easy for someone else to run snips.sh on their own hardware. And that's exactly why we have a [self hosting guide](https://snips.sh/docs/self-hosting.md) and publish an multi-arch container image to GitHub Container Registry:

```
ghcr.io/robherley/snips.sh
```

Given the simple tech stack, it's pretty easy to get going after a couple volume mounts and environment variables.

## The tensorflow-sized elephant in the room

So, one _must have_ that I wanted for snips is to automatically detect the uploaded code language. To do this, I used a tensorflow model, [`yoeo/guesslang`](https://github.com/yoeo/guesslang). This is actually the same model that [Visual Studio Code](https://code.visualstudio.com/) uses, but they use [Tensorflow.js](https://www.tensorflow.org/js/), you can check it out at [`Microsoft/vscode-languagedetection`](https://github.com/Microsoft/vscode-languagedetection).

But we do not have server side JS here, we're in a compiled language. This was my first hurdle, and I ended up writing [`robherley/guesslang-go`](https://github.com/robherley/guesslang-go) which uses some wrappers around libtensorflow's C API.

Unfortunately, this means we lose the ability to make a static executable and need to sacrifice portability:

{{< terminal >}}
you@local$ docker run -it --entrypoint=ldd ghcr.io/robherley/snips.sh /usr/bin/snips.sh
	linux-vdso.so.1 (0x00007ffd219a8000)
	libtensorflow.so.2 => /usr/local/lib/libtensorflow.so.2 (0x00007f2922485000)
	libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f292225c000)
	libtensorflow_framework.so.2 => /usr/local/lib/libtensorflow_framework.so.2 (0x00007f292036d000)
	librt.so.1 => /lib/x86_64-linux-gnu/librt.so.1 (0x00007f2920368000)
	libdl.so.2 => /lib/x86_64-linux-gnu/libdl.so.2 (0x00007f2920363000)
	libm.so.6 => /lib/x86_64-linux-gnu/libm.so.6 (0x00007f292027a000)
	libpthread.so.0 => /lib/x86_64-linux-gnu/libpthread.so.0 (0x00007f2920275000)
	libstdc++.so.6 => /lib/x86_64-linux-gnu/libstdc++.so.6 (0x00007f2920049000)
	libgcc_s.so.1 => /lib/x86_64-linux-gnu/libgcc_s.so.1 (0x00007f2920029000)
	/lib64/ld-linux-x86-64.so.2 (0x00007f2933a32000)
{{< /terminal >}}

Even worse, look how big this is!

{{< terminal >}}
you@local$ docker run -it --entrypoint=ls ghcr.io/robherley/snips.sh -lah /usr/local/lib
total 416M
drwxr-xr-x 1 root root 4.0K Sep 13 15:53 .
drwxr-xr-x 1 root root 4.0K Aug  8 14:03 ..
-r-xr-xr-x 1 root root 375M Sep 13 15:51 libtensorflow.so.2
-r-xr-xr-x 1 root root  42M Sep 13 15:51 libtensorflow_framework.so.2
{{< /terminal >}}

Yikes. Not ideal.

I did search for alternatives, like relying on chroma's [built in lexers to identify the language](https://github.com/alecthomas/chroma#identifying-the-language) but it was not good enough for small snippets. Other language detection features of editors and other tools like GitHub's [linguist](https://github.com/github-linguist/linguist) rely on file extensions, which we don't have.

This is a prime example of making sacrifices for an extremely useful feature. It does put a smile on my face when I see the correct language detected on upload.

Another huge gotcha with libtensorflow is the lack of support for many architectures. Luckily this can be solved with some compiler flags (`-tags noguesser`) and a multiarch container image, but some users lose that critical functionality.

This is an area that I am not very strong in. I'd love any suggestions on this topic, feel free to [open an issue](https://github.com/robherley/snips.sh/issues).

## The ship

I started on this side project at the beginning of 2023[^3], and "released" it via social media in May of that same year. This was my first real side-hack that turned into a pretty useful tool, and I felt a warm welcome from the developer community.

My largest audience was Twitter, having over 120k views on [my tweet](https://x.com/robherley/status/1657139515557920770). Some retweets from folks like [@mxcl](https://twitter.com/mxcl) (creator of Homebrew) and [@charmcli](https://twitter.com/charmcli) really helped get it to the right audience.

Surprisingly, even folks on reddit took it pretty well!

{{< reddit "https://www.reddit.com/r/golang/comments/13fyp1k/snipssh_passwordless_anonymous_sshpowered_pastebin/" "snips.sh: passwordless, anonymous SSH-powered pastebin" >}}

I was delighted to see snips.sh in all difference communities:
- [console.dev](https://console.dev) made a review: https://console.dev/tools/snips
- [@JeremiahSecrist](https://github.com/JeremiahSecrist) published a nixpkg: https://mynixos.com/nixpkgs/package/snips-sh
- [@Sanix-Darker](https://github.com/Sanix-Darker) made a nvim extension: https://github.com/Sanix-Darker/snips.nvim

Shortly after release, we already had issues and contributions coming in too!

It truly was a great ship! 🚢

## The numbers

### Connections

Users can reach snips.sh via HTTP or SSH. The request metrics are emitted to DataDog but unfortunately I only have up to a little over a year's worth of retention, so here's since July 2023:

{{< row >}}

{{< count n="130844" label="HTTP Requests" color="green-6" >}}

{{< count n="116889" label="SSH Sessions" color="amber-6" >}}

{{</ row >}}

Note: the above SSH sessions are for successfully authenticated users. If we include all non-authenticated (anything hitting port 22), snips.sh has seen **2.148 million** unique SSH sessions.

### App

This entire app is hosted on a [Digital Ocean](https://digitalocean.com) droplet to keep costs low. The database is still relatively small around **~24MB**, which is not including backups on [Digital Ocean Spaces](https://www.digitalocean.com/products/spaces) via [litestream](https://litestream.io).

{{< row >}}

{{< count n="1534" label="Users" color="purple-6" >}}

{{< count n="2486" label="Files" color="blue-9" >}}

{{< count n="57" label="Langs" color="teal-9" >}}

{{< /row >}}

After copying the sqlite database to my host machine and running aggregations, we can see a nice time series of usage:

![users created over time](/content/snips-retro/users-created.png "")

![files created over time](/content/snips-retro/files-created.png "")

Unsurprisingly, we had a huge burst of users during the "Twitter hype period" and gradually slowed down. While I would have loved to market this more, my goal wasn't to make a disrupting product, just a fun developer tool. Plus, over the lifecycle of this release, I was busy planning an engagement and then my wedding!

Back to the metrics, we had the usual suspects of popular files.

![files by type](/content/snips-retro/files-by-lang.png "Files by programming language")

You can find the full language list... [on snips](https://snips.sh/f/yfojYVMqSU)!

### Open Source

We've had some great contributions like [zstd compression](https://github.com/robherley/snips.sh/pull/46), [arm64 support](https://github.com/robherley/snips.sh/pull/42), bug fixes and more. Dependabot is also carrying the weight a bit with **~65** Pull Requests alone.

{{< row >}}

{{< count n="148" label="Commits" color="green-9" >}}

{{< count n="175" label="Pull Requests" color="purple-6" >}}

{{< count n="26" label="Issues" color="teal-9" >}}

{{< count n="1028" label="Stars" color="amber-9" >}}

{{< count n="13" label="Contributors" color="pink-9" >}}

{{</ row >}}

## Thanks!

Appreciate all the contributions and kind words people have given me throughout this project! It gives me the motivation to keep on building, and you should too 💪

[^1]: https://sqlite.org/fasterthanfs.html
[^2]: https://fly.io/docs/litefs/
[^3]: https://github.com/robherley/snips.sh/commit/4982dafd6204d56c7670aa2ef258638e318447f4
