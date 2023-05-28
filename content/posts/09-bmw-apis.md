---
title: "🚗 Reverse Engineering BMW ConnectedDrive APIs"
date: 2022-12-31T20:41:45.498Z
draft: false
tags:
  - rust
  - reverse-engineering
  - bmw
---

## New car

<!-- Insert photo of car here -->

I recently purchases a 2020 BMW m340i xDrive, and I'm in love with it. It's fast, full of tech and looks absolutely beautiful.

BMWs come with [ConnectedDrive](https://www.bmwusa.com/explore/connecteddrive.html) which allows communication between your BMW (and MINI?) vehicle and other devices.

So, what if I could make a tool like [neofetch](https://github.com/dylanaraps/neofetch), but for my BMW status?

## Reverse engineering

Luckily, most of the [My BMW Garage](https://mygarage.bmwusa.com/) website is client side rendered and makes fetch requests to BMW servers.

Snooping through my browser's web console, I found that _most_ requests are to `https://mygarage.bmwusa.com/bin/api/forward` with some query parameters:
- `GroupId`: a guid unknown to me
- `targetURL`: path to a resource, like `/mybmw/resources/garage/getGarageVehiclesByGroupId`
- `gcid`: another unknown guid
- `Brand`: for all of my requests these are "BMWAUTO", wonder if it varies for MINI?

So my best guess is that this is some middle proxy for the frontend to "forward" requests to internal BMW APIs. Looking for obvious signs of auth, I found the follwing in the request header:

```
Authorization: gcid=<omitted>,token=<omitted>
```

The `gcid` matches the query parameter in the request and it looks like the `token` is the key to authorizing these requests. I copied the request as curl from the web console and played around with the parameters until I was able to get a successful request with only the following:

```
curl 'https://mygarage.bmwusa.com/bin/api/forward?$QUERY_PARAMS' \
  -H 'Authorization: token=$TOKEN' \
  -H 'Referer: https://mygarage.bmwusa.com/' \
```

(without the `Referrer` header the API would send a `403` 🤷)

Another fun find was that the web client also makes an unauthenticated request to `https://mygarage.bmwusa.com/content/dam/mybmw/endpoints/Endpoints.json` which gives us a great list of endpoints we can play with:

```json
{
  "GET_GARAGE_VEHICLES_BY_GROUPID": "/mybmw/resources/garage/getGarageVehiclesByGroupId",
  // ...
}
```

So to actually make requests on our own, we need to figure out the following:

1. How to get a token?
2. What is `gcid`?
3. What is `GroupId`?

### How to get a token?

The obvious place is to start with the login page at [https://login.bmwusa.com/](https://login.bmwusa.com/). After entering in some credentials, the browser fires off a _bunch_ of requests but the first two requests stand out:

`POST https://login.bmwusa.com/gcdm/oauth/authenticate`

These are two `POST` requests that have `application/x-www-form-urlencoded` payloads that look suspiciously like oauth requests. They are nearly identical, except one is for a `request_type` of `code` and other for `token`.

I was unable to find anything useful from the `code` request, but the `token` request would issue a `302` that had a `Location` header:

```
https://mygarage.bmwusa.com/content/mybmw/en/code-receiver.html#access_token=<omitted>&state=https://mygarage.bmwusa.com/&token_type=Bearer&expires_in=3599&client_id=0ff35533-1794-499b-90bb-1a80ddc24e20
```

Sweet, we now have a way to easily obtain a bearer token from BMW. Testing it with the cURL request above, it works!
