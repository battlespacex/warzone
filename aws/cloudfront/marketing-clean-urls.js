// Associate with the stratops.space CloudFront distribution viewer-request event.
// Required when S3 uses a REST/OAC origin and HTML pages are in /pages/.
// IMPORTANT: Merge with any existing CloudFront Function logic; don't overwrite
// redirects or rules already installed on other distributions.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '/' || uri === '/index.html') {
    request.uri = '/pages/index.html';
    return request;
  }
  var pages = ['capabilities', 'intelligence', 'about', 'contact'];
  for (var i = 0; i < pages.length; i++) {
    if (uri === '/' + pages[i] || uri === '/' + pages[i] + '/') {
      request.uri = '/pages/' + pages[i] + '.html';
      return request;
    }
  }
  if (uri === '/404' || uri === '/404/') {
    request.uri = '/pages/404.html';
  }
  return request;
}
