import { useCallback, useRef, useState } from 'react'

export type EditorHistoryAction = {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

export default function useEditorHistory(limit = 60) {
  const undoStack = useRef<EditorHistoryAction[]>([])
  const redoStack = useRef<EditorHistoryAction[]>([])
  const busyRef = useRef(false)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const refresh = () => setVersion(value => value + 1)

  const record = useCallback((action: EditorHistoryAction) => {
    undoStack.current = [...undoStack.current.slice(-(limit - 1)), action]
    redoStack.current = []
    refresh()
  }, [limit])

  const undo = useCallback(async () => {
    const action = undoStack.current.at(-1)
    if (!action || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action.undo()
      undoStack.current.pop()
      redoStack.current.push(action)
      refresh()
    } catch {
      // The mutation helper already surfaced the API error. Keep the action
      // on its current stack so the user can retry after connectivity returns.
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const redo = useCallback(async () => {
    const action = redoStack.current.at(-1)
    if (!action || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action.redo()
      redoStack.current.pop()
      undoStack.current.push(action)
      refresh()
    } catch {
      // Preserve redo state when the server rejects the operation.
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const clear = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    refresh()
  }, [])

  void version
  return {
    record, undo, redo, clear, busy,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undoLabel: undoStack.current.at(-1)?.label || '',
    redoLabel: redoStack.current.at(-1)?.label || '',
  }
}
