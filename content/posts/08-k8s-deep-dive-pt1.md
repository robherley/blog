---
title: "🏊‍♂️ Kubernetes Deep Dive I: Why Kubernetes?"
date: 2022-05-25T20:34:07-04:00
draft: false
---

👋 Ever deployed to Kubernetes before and want to really know what happens to that YAML after `kubectl apply`? Or are you completely new to Kubernetes and want to understand the magic behind the curtain? In this series I'll break down the core concepts of what makes Kubernetes tick and even guide you through building your own custom resource definitions (CRDs), resource controller, and webhooks.

## But why?

If you haven't heard, [Kubernetes](https://kubernetes.io/) is everywhere. All of the major cloud providers have their own fancy distributions, and it's even available as a [~50MB binary](https://k3s.io/). It's a great container orchestration platform and arguably one of the most important pieces of modern cloud computing infrastructure. Kubernetes is currently powering some of world's the most critical systems, like serving [delicious chicken 🍗](https://medium.com/@cfatechblog/bare-metal-k8s-clustering-at-chick-fil-a-scale-7b0607bd3541) (the clusters still work on Sundays).

Just a few years ago, companies across all industries started acquiring a taste for the Kubernetes Kool-Aid 🍹. It was very promising: being cloud agnostic[^1], "planet scale" to meet any business needs and magic self-healing for zero downtime even in the event of catastrophic hardware failure. Thus began the paradigm shift to the land of containerization where entire clusters were being created to host a single static HTML site.

[^1]: Good luck finding an cloud agnostic ingress solution that doesn't glue to your favorite cloud provider with a half dozen annotations.

But, the advantages of Kubernetes came at a price. It wasn't as simple as `heroku create my-app` anymore. You need a container image, YAML manifests, role based access control, networking configuration, storage providers, backup plans, etc. This kind of overhead can cause significant friction, which leads me to my super reductive statement of the three types of Kubernetes users:

1. The users who develop components/tooling/abstractions on top of Kubernetes to be consumed by others.
2. The users who throw YAML at the cluster and hope for the best.
3. The users who don't know they're using Kubernetes because of the folks in **#1**.

A majority of people in bucket **#1** were/are system administrators that have begrudgingly taken ownership of clusters and build opinionated abstractions to easy the onboarding/maintenance of developer workloads, I like to call this the "platform bridge".

The less fortunate people in **#2** don't have the luxury of dedicated sysadmins to manage their clusters, so they usually end up with a DIY solution on some cloud provider's managed cluster.

For **#3** the tooling abstractions away Kubernetes that the developers don't know or care what the underlying infrastructure is. (This is a good thing!)

There's a slow but deadly pipeline from user **#2** to becoming user **#1**. It even has a title, the infamous "DevOps" engineer. These are the types of engineers expected to do everything from advertising BGP routes to centering some `<div>` elements with CSS.

![stack overflow upwards trend for DevOps](/content/k8s-deep-dive/stack-overflow-trends.png "Stack Overflow Trends for `devops`")

❓ Can you guess from the chart what year Kubernetes v1.0 was released?

As a recovering DevOps engineer, I can personally attest of the endless rabbit holes of Kubernetes management and the temptations to build a homegrown solutions from scratch. My goal by the end of this series is to help users who develop on Kubernetes to build better, opinionated abstractions and for those who consume Kubernetes to have a better high level understanding.

