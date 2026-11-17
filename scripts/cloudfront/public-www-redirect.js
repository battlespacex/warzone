// CloudFront Functions runtime 2.0, viewer-request, PUBLIC distribution only.
// Deploy manually after review. Do not associate with the operational portal.
function handler(event) {
    var request = event.request;
    if (!request.headers.host || request.headers.host.value.toLowerCase() !== 'www.stratops.space') return request;
    var query = [];
    Object.keys(request.querystring || {}).forEach(function (key) {
        var item = request.querystring[key];
        (item.multiValue || [item]).forEach(function (part) { query.push(key + '=' + part.value); });
    });
    // CloudFront supplies URI-encoded query names and values; preserve them unchanged.
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: {
        location: { value: 'https://stratops.space' + request.uri + (query.length ? '?' + query.join('&') : '') },
        'cache-control': { value: 'public, max-age=300' }
    } };
}
