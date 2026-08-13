# Poster private-route CloudFront gate

The repository does not contain the production CloudFront distribution or its infrastructure-as-code configuration. The `/poster` build is therefore deliberately unlinked and non-indexable, but it is not access-controlled until this viewer-request function is deployed.

Create a CloudFront Function from the following template. Replace `__POSTER_ACCESS_TOKEN__` during deployment from the deployment secret store; never commit or expose the real value in frontend JavaScript.

```js
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    var isPosterPage = uri === "/poster" || uri === "/poster/" || uri === "/poster/index.html";

    if (!isPosterPage) {
        return request;
    }

    var access = request.querystring && request.querystring.access;
    if (!access || access.value !== "__POSTER_ACCESS_TOKEN__") {
        return {
            statusCode: 404,
            statusDescription: "Not Found",
            headers: {
                "cache-control": { value: "no-store, max-age=0" },
                "content-type": { value: "text/plain; charset=utf-8" },
                "x-robots-tag": { value: "noindex, nofollow, noarchive, nosnippet" }
            },
            body: "Not Found"
        };
    }

    delete request.querystring.access;
    request.uri = "/poster/index.html";
    return request;
}
```

Deployment configuration:

1. Generate a high-entropy token outside Git and substitute it only in the deployed function code.
2. Publish the function and associate it with the StratOps distribution's viewer-request event for the behavior that includes `/poster*`.
3. Keep the function association ahead of the cache lookup. The function validates every request, then removes the token from the origin/cache key and rewrites the clean route to `/poster/index.html`.
4. Attach a response headers policy for `/poster*` that adds `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` to successful origin responses.
5. Invalidate `/poster` and `/poster/index.html` after deploying the function and build.
6. Verify `/poster` returns 404 without the token and `/poster?access=<deployment-token>` returns the tool.

The shared `/assets/images/poster/` and `/assets/fonts/` files remain regular static assets. They do not expose the tool or the access token.

The included Express static server also fails closed in production unless `POSTER_ACCESS_TOKEN` is configured and supplied as `?access=...`. Local development bypasses that check. This protects Express-hosted deployments only; it does not replace the CloudFront function for the stated S3/CloudFront production architecture.
