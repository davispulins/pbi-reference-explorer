import { analyzeProject } from '../lib/analyzer'
import type {
  WorkerAnalyzeRequest,
  WorkerAnalyzeResponse,
} from '../types'

self.onmessage = (event: MessageEvent<WorkerAnalyzeRequest>) => {
  try {
    const bundle = analyzeProject(event.data.files)
    const response: WorkerAnalyzeResponse = {
      ok: true,
      requestId: event.data.requestId,
      bundle,
    }
    self.postMessage(response)
  } catch (error) {
    const response: WorkerAnalyzeResponse = {
      ok: false,
      requestId: event.data.requestId,
      error: error instanceof Error ? error.message : 'Unknown analysis error.',
    }
    self.postMessage(response)
  }
}
