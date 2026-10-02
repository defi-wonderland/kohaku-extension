// Content Script for injecting the window.ethereum provider in the pages that we connect to
const injectEthereumProviderScript = () => {
  // the script element with src won't execute immediately use inline script element instead!
  const container = document.head || document.documentElement
  const ethereumInpageScript = document.createElement('script')
  // Otherwise the script will mess with the global scope of the page
  ethereumInpageScript.type = 'module'

  // '#ETHEREUMINPAGE#' is a string replaced by webpack
  // via the AssetReplacePlugin with the real js content of each file
  ethereumInpageScript.textContent = '#ETHEREUMINPAGE#'
  container.insertBefore(ethereumInpageScript, container.children[1])
  container.removeChild(ethereumInpageScript)
}

injectEthereumProviderScript()
