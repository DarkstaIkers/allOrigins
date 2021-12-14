const fs = require('fs').promises
const { got } = require('./http-client')
const puppeteer = require('puppeteer-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const NodeCache = require('node-cache')
const crpCache = new NodeCache({ stdTTL: 36000, checkperiod: 120 })

puppeteer.use(stealth())

module.exports = getPage

function getPage({ url, format, requestMethod }) {
  if (format === 'info' || requestMethod === 'HEAD') {
    return getPageInfo(url)
  } else if (format === 'raw') {
    return getRawPage(url, requestMethod)
  } else if (format === 'vilos' || format === 'viloslog') {
    return getVilosMedia(url, format === 'viloslog')
  } else if (format === 'lastlog') {
    return getLastLog()
  }

  return getPageContents(url, requestMethod)
}

async function getPageInfo(url) {
  const { response, error } = await request(url, 'HEAD')
  if (error) return processError(error)

  return {
    url: url,
    content_type: response.headers['content-type'],
    content_length: +response.headers['content-length'] || -1,
    http_code: response.statusCode,
  }
}

async function getRawPage(url, requestMethod) {
  const { content, response, error } = await request(url, requestMethod, true)
  if (error) return processError(error)

  const contentLength = Buffer.byteLength(content)
  return {
    content,
    contentType: response.headers['content-type'],
    contentLength,
  }
}

const ignore = ['media', 'font', 'image', 'stylesheet']
async function getFromNavigation(url, shouldLog) {
  const options = getStealthOptions()
  const browser = await puppeteer.launch(options)
  const [page] = await browser.pages()

  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (ignore.includes(request.resourceType())) request.abort()
    else request.continue()
  })

  await page.setViewport({ width: 800, height: 600 })

  await page.goto(url)
  const data = await page.evaluate(() => document.querySelector('*').outerHTML)

  if (shouldLog) fs.writeFile('last.log', data)
  await browser.close()

  return data
}

async function getLastLog() {
  try {
    return await fs.readFile('last.log', 'utf-8')
  } catch (err) {
    return 'empty last log'
  }
}

async function getVilosMedia(url, shouldLog) {
  const cached = crpCache.get(url)
  if (cached && !shouldLog) return cached

  const htmlPage = await getFromNavigation(url, shouldLog)
  if (!htmlPage) return '"{}"'

  const startIndex = htmlPage.indexOf('config.media =')
  const initialConfig = htmlPage.substr(startIndex + 15)

  const endIndex = initialConfig.indexOf('\n\n')
  const config = initialConfig.substr(0, endIndex - 1)

  crpCache.set(url, config)
  return config
}

function getStealthOptions() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-infobars',
    '--window-position=0,0',
    '--ignore-certifcate-errors',
    '--ignore-certifcate-errors-spki-list',
    '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36"'
  ]

  return {
    args,
    headless: true,
    ignoreHTTPSErrors: true,
    userDataDir: './tmp'
  }
}

async function getPageContents(url, requestMethod) {
  const { content, response, error } = await request(url, requestMethod)
  if (error) return processError(error)

  const contentLength = Buffer.byteLength(content)
  return {
    contents: content.toString(),
    status: {
      url: url,
      content_type: response.headers['content-type'],
      content_length: contentLength,
      http_code: response.statusCode,
    },
  }
}

async function request(url, requestMethod, raw = false) {
  try {
    const options = {
      method: requestMethod,
      decompress: !raw,
    }

    const response = await got(url, options)
    if (options.method === 'HEAD') return { response }

    return processContent(response)
  } catch (error) {
    return { error }
  }
}

async function processContent(response) {
  const res = { response: response, content: response.body }
  return res
}

async function processError(e) {
  const { response } = e
  if (!response) return { contents: null, status: { error: e } }

  const { url, statusCode: http_code, headers, body } = response
  const contentLength = Buffer.byteLength(body)

  return {
    contents: body.toString(),
    status: {
      url,
      http_code,
      content_type: headers['content-type'],
      content_length: contentLength,
    },
  }
}
