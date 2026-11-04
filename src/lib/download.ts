/**
 * Starts a browser download without navigating the app: a temporary anchor
 * with `download` is clicked and removed. For a cross-origin URL the browser
 * ignores `download`, so the server must answer with `Content-Disposition:
 * attachment` (Storage does for signed URLs created with `{ download }`).
 */
export function triggerDownload(href: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * Saves a blob under `fileName` through an object URL, revoked on the next
 * tick (revoking synchronously can cancel the download in some browsers).
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  try {
    triggerDownload(url, fileName)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
