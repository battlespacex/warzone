// Optional: associate with the stratops.space CloudFront distribution viewer-request
// ONLY if its S3 REST/OAC origin does not resolve directory index files.
// Do not replace an existing CloudFront function without merging its other logic.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '/') { request.uri = '/index.html'; return request; }
  var pages = ['/capabilities','/intelligence','/about','/contact'];
  for (var i = 0; i < pages.length; i++) {
    if (uri === pages[i] || uri === pages[i] + '/') {
      request.uri = pages[i] + '/index.html';
      return request;
    }
  }
  return request;
}
