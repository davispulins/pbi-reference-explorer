import { analyzeProject } from '../lib/analyzer'
import type {
  WorkerAnalyzeRequest,
  WorkerAnalyzeResponse,
} from '../types'

self.onmessage = (event: MessageEvent<WorkerAnalyzeRequest>) => {
  try {
    const bundle = analyzeProject(event.data.files)
    const response: WorkerAnalyzeResponse = { ok: true, bundle }
    self.postMessage(response)
  } catch (error) {
    const response: WorkerAnalyzeResponse = {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown analysis error.',
    }
    self.postMessage(response)
  }
}
