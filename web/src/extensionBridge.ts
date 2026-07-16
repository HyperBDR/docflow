import { api } from './api'

type ExtensionCommand = 'DOCFLOW_EXTENSION_CONNECT' | 'DOCFLOW_EXTENSION_SET_TARGET' | 'DOCFLOW_EXTENSION_PING'

function requestId() {
  return `docflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function sendExtensionCommand(type: ExtensionCommand, payload: Record<string, unknown> = {}, timeout = 3500): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const id = requestId()
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', receive)
      reject(new Error('extension_not_detected'))
    }, timeout)
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return
      if (event.data?.source !== 'docflow-extension' || event.data?.requestId !== id) return
      window.clearTimeout(timer); window.removeEventListener('message', receive)
      const error = event.data.error || event.data.result?.error
      if (error) reject(new Error(String(error)))
      else resolve(event.data.result || {})
    }
    window.addEventListener('message', receive)
    window.postMessage({ source: 'docflow-web', requestId: id, type, ...payload }, window.location.origin)
  })
}

export async function connectBrowserExtension() {
  const pairing = await api.pair()
  return sendExtensionCommand('DOCFLOW_EXTENSION_CONNECT', { code: pairing.code })
}

export function detectBrowserExtension() {
  return sendExtensionCommand('DOCFLOW_EXTENSION_PING', {}, 2500)
}

export async function prepareExtensionRecording(demoId: string) {
  try {
    return await sendExtensionCommand('DOCFLOW_EXTENSION_SET_TARGET', { demoId })
  } catch (error) {
    if ((error as Error).message === 'extension_not_detected') throw error
    await connectBrowserExtension()
    return sendExtensionCommand('DOCFLOW_EXTENSION_SET_TARGET', { demoId })
  }
}
