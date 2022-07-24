---
title: "🎨 Beautify your Go tests on GitHub Actions"
date: 2022-07-23T00:51:58-04:00
draft: false
tags:
  - golang
  - testing
  - github
  - actions
---

## Was this made for humans?

Although simple, Go's default testing output leaves a lot to be desired:

![go test output](/content/beautify-go-tests/gotest.png)

This has led rise to some other wrappers for `go test`, solely to be a better formatter for humans. For example, [`gotestsum`](https://github.com/gotestyourself/gotestsum) does this quite well:

![gotestsum output](/content/beautify-go-tests/gotestsum.png)

This is definitely an improvement, and `gotestsum` even has additional formatting like exporting to JUnit XML.

But, what if CI could produce a rich, interactive, summary like this:

![gotestaction overview](/content/beautify-go-tests/gotestaction.png)

And interactive expansion for more details:

![gotestaction expansion](/content/beautify-go-tests/gotestaction2.png)

(Check out the [example here](https://github.com/robherley/go-test-example/actions/runs/2725452630/attempts/1#summary-7484360764)!)

## Actions Job Summaries

One of the great features my team released recently was GitHub Actions [Job Summaries](https://github.blog/2022-05-09-supercharging-github-actions-with-job-summaries/). If you haven't heard of it yet, it's a very simple way to get Markdown content as an output for a GitHub Actions job.

It's relatively easy to use, we provide two mechanisms to write summary content:

1. Writing [GitHub Flavored Markdown](https://github.github.com/gfm/) to the file at `$GITHUB_STEP_SUMMARY` on all GitHub Actions runners.
2. Utilizing the `@actions/core`'s TypeScript [helper library](https://github.com/actions/toolkit/blob/main/packages/core/src/summary.ts).

And the latter is what I used to create [`go-test-action`](https://github.com/robherley/go-test-action).

## Introducing: `go-test-action`

It should be easy to get a pretty test summary.

With `go-test-action`, all you need is to replace _one line_ in your Actions Workflow:

```diff
name: CI

on:
  push:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3

    - name: Set up Go
      uses: actions/setup-go@v3
      with:
        go-version: 1.18

    - name: Build
      run: go build -v ./...

    - name: Test
-     run: go test ./...
+     uses: robherley/go-test-action@v0.1.0
```

If your test parameters are a bit more complicated or if you want to customize the summary structure, there are a few [inputs](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepswith) that you can use:

| Input | Default | Description |
| -     | -       | -           |
| moduleDirectory | `.` | relative path to the directory containing the `go.mod` of the module you wish to test |
| testArguments | `./...` | arguments to pass to `go test`, `-json` will be prepended automatically |
| omitUntestedPackages | `false` |  omit any go packages that don't have any tests from the summary output |
| omitPie | `false` | omit the pie chart from the summary output

So if you really hate 🥧, you can change your Workflow to omit it:

```yaml
    - name: Test
      uses: robherley/go-test-action@v0.1.0
      with:
        omitPie: true
```

For the most up-to-date list of inputs, check out the [action.yml](https://github.com/robherley/go-test-action/blob/main/action.yml)

## But how does it work?

When executing the tests, `go-test-action` will prepend the arguments with `-json`, that will convert the output to JSON using [test2json](https://pkg.go.dev/cmd/test2json).

The `test2json` JSON output is structured like so:

```go
type TestEvent struct {
	Time    time.Time
	Action  string
	Package string
	Test    string
	Elapsed float64
	Output  string
}
```

The actual output is a bit chunky:

```json
{"Time":"2022-07-10T22:42:11.92576-04:00","Action":"output","Package":"github.com/robherley/go-test-example","Output":"?   \tgithub.com/robherley/go-test-example\t[no test files]\n"}
{"Time":"2022-07-10T22:42:11.926603-04:00","Action":"skip","Package":"github.com/robherley/go-test-example","Elapsed":0.001}
{"Time":"2022-07-10T22:42:11.931066-04:00","Action":"run","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess"}
{"Time":"2022-07-10T22:42:11.931141-04:00","Action":"output","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess","Output":"=== RUN   TestSuccess\n"}
{"Time":"2022-07-10T22:42:11.931166-04:00","Action":"run","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess/Subtest(1)"}
{"Time":"2022-07-10T22:42:11.931185-04:00","Action":"output","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess/Subtest(1)","Output":"=== RUN   TestSuccess/Subtest(1)\n"}
{"Time":"2022-07-10T22:42:11.931204-04:00","Action":"output","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess/Subtest(1)","Output":"    success_test.go:19: hello from subtest #1\n"}
{"Time":"2022-07-10T22:42:11.931239-04:00","Action":"run","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess/Subtest(2)"}
{"Time":"2022-07-10T22:42:11.931284-04:00","Action":"output","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess/Subtest(2)","Output":"=== RUN   TestSuccess/Subtest(2)\n"}
{"Time":"2022-07-10T22:42:11.9313-04:00","Action":"output","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess/Subtest(2)","Output":"    success_test.go:19: hello from subtest #2\n"}
{"Time":"2022-07-10T22:42:11.931315-04:00","Action":"run","Package":"github.com/robherley/go-test-example/success","Test":"TestSuccess/Subtest(3)"}
// and more!
```

This JSON output is parsed, grouped and aggregated like so:

- For every _package level_ test, group the following:
  - Count tests that have a _conclusive_ attribute. Conclusive meaning their `test2json` output `Action` is either is `pass`, `fail` or `skip`.
  - Repeat above for any subtests with a test (subtests in go with [`T.Run`](https://pkg.go.dev/testing#hdr-Subtests_and_Sub_benchmarks) are naively indicated with a `/` in their name)

This logic is split between the [`parseTestEvents`](https://github.com/robherley/go-test-action/blob/6a4c0a24d1b6c6df89b9aa634ac98682e4dedced/src/events.ts#L46) function and the [`PackageResult`](https://github.com/robherley/go-test-action/blob/6a4c0a24d1b6c6df89b9aa634ac98682e4dedced/src/results.ts#L11) class. And once it's all parsed, the attributes are rendered to Markdown by the [`Renderer`](https://github.com/robherley/go-test-action/blob/6a4c0a24d1b6c6df89b9aa634ac98682e4dedced/src/renderer.ts#L14) class.

## Contribute!

Have an idea for a feature or want to report a bug? Feel free to open an [issue](https://github.com/robherley/go-test-action/issues) or submit a [pull request](https://github.com/robherley/go-test-action/pulls)!

Thanks for reading and happy testing! 🧪