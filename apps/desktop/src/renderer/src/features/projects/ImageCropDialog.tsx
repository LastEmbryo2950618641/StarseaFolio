import { useCallback, useEffect, useRef, useState } from "react"
import { Crop, Minus, Plus, RotateCcw, X } from "lucide-react"

export const COVER_OUTPUT_SIZE = Object.freeze({ width: 600, height: 800 })

type Size = Readonly<{ width: number; height: number }>
type Point = Readonly<{ x: number; y: number }>
type Props = Readonly<{
  src: string
  busy?: boolean
  onCancel(): void
  onConfirm(dataUrl: string): void
}>

export function coverBaseScale(image: Size, stage: Size): number {
  if (image.width <= 0 || image.height <= 0 || stage.width <= 0 || stage.height <= 0) return 1
  return Math.max(stage.width / image.width, stage.height / image.height)
}

function clampOffset(offset: Point, image: Size, stage: Size, scale: number): Point {
  const imageWidth = image.width * scale
  const imageHeight = image.height * scale
  return {
    x: Math.min(0, Math.max(stage.width - imageWidth, offset.x)),
    y: Math.min(0, Math.max(stage.height - imageHeight, offset.y)),
  }
}

export function ImageCropDialog(props: Props): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<Readonly<{ pointerId: number; start: Point; origin: Point }> | undefined>(undefined)
  const initializedRef = useRef(false)
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 })
  const [image, setImage] = useState<Size>({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const measureStage = useCallback(() => {
    const element = stageRef.current
    if (element === null) return
    setStage({ width: element.clientWidth, height: element.clientHeight })
  }, [])

  useEffect(() => {
    measureStage()
    const element = stageRef.current
    if (element === null || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measureStage)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measureStage])

  useEffect(() => {
    if (image.width <= 0 || image.height <= 0 || stage.width <= 0 || stage.height <= 0) return
    if (!initializedRef.current) {
      const scale = coverBaseScale(image, stage)
      setOffset({
        x: (stage.width - image.width * scale) / 2,
        y: (stage.height - image.height * scale) / 2,
      })
      initializedRef.current = true
    } else {
      setOffset((current) => clampOffset(current, image, stage, coverBaseScale(image, stage) * zoom))
    }
  }, [image, stage, zoom])

  const baseScale = coverBaseScale(image, stage)
  const displayScale = baseScale * zoom
  const displaySize = { width: image.width * displayScale, height: image.height * displayScale }

  const changeZoom = (nextZoom: number): void => {
    const next = Math.min(3, Math.max(1, nextZoom))
    if (stage.width <= 0 || displayScale <= 0) {
      setZoom(next)
      return
    }
    const center = { x: stage.width / 2, y: stage.height / 2 }
    const imagePoint = {
      x: (center.x - offset.x) / displayScale,
      y: (center.y - offset.y) / displayScale,
    }
    const nextScale = baseScale * next
    setZoom(next)
    setOffset(clampOffset({
      x: center.x - imagePoint.x * nextScale,
      y: center.y - imagePoint.y * nextScale,
    }, image, stage, nextScale))
  }

  const resetPosition = (): void => {
    const scale = coverBaseScale(image, stage)
    setZoom(1)
    setOffset({
      x: (stage.width - image.width * scale) / 2,
      y: (stage.height - image.height * scale) / 2,
    })
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (props.busy === true || image.width <= 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: offset }
    setDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === undefined) return
    setOffset(clampOffset({
      x: drag.origin.x + event.clientX - drag.start.x,
      y: drag.origin.y + event.clientY - drag.start.y,
    }, image, stage, displayScale))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = undefined
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const confirm = (): void => {
    if (imageRef.current === null || image.width <= 0 || stage.width <= 0 || stage.height <= 0) return
    const canvas = document.createElement("canvas")
    canvas.width = COVER_OUTPUT_SIZE.width
    canvas.height = COVER_OUTPUT_SIZE.height
    const context = canvas.getContext("2d")
    if (context === null) return
    const sourceX = Math.max(0, -offset.x / displayScale)
    const sourceY = Math.max(0, -offset.y / displayScale)
    const sourceWidth = Math.min(image.width - sourceX, stage.width / displayScale)
    const sourceHeight = Math.min(image.height - sourceY, stage.height / displayScale)
    context.drawImage(imageRef.current, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
    props.onConfirm(canvas.toDataURL("image/jpeg", 0.9))
  }

  return <div className="dialog-backdrop" role="presentation">
    <section className="image-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="image-crop-title" data-testid="image-crop-dialog">
      <header className="image-crop-dialog__header">
        <div>
          <strong id="image-crop-title"><Crop size={16} /> 调整封面</strong>
          <small>固定比例 3:4 · 输出 600 × 800</small>
        </div>
        <button type="button" className="icon-button" aria-label="取消更换封面" title="取消" disabled={props.busy === true} onClick={props.onCancel}><X size={17} /></button>
      </header>
      <div className="image-crop-dialog__body">
        <div
          ref={stageRef}
          className={`image-crop-stage${dragging ? " is-dragging" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            ref={imageRef}
            src={props.src}
            alt="待裁剪的封面"
            draggable={false}
            className="image-crop-stage__image"
            style={{ width: displaySize.width, height: displaySize.height, left: offset.x, top: offset.y }}
            onLoad={(event) => {
              setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              measureStage()
            }}
          />
          {image.width <= 0 ? <span className="image-crop-stage__loading">正在加载图片…</span> : null}
        </div>
        <div className="image-crop-controls">
          <button type="button" className="icon-button" aria-label="缩小" title="缩小" disabled={props.busy === true || zoom <= 1} onClick={() => { changeZoom(zoom - 0.1) }}><Minus size={16} /></button>
          <input aria-label="封面缩放" type="range" min="1" max="3" step="0.01" value={zoom} disabled={props.busy === true} onChange={(event) => { changeZoom(Number(event.target.value)) }} />
          <button type="button" className="icon-button" aria-label="放大" title="放大" disabled={props.busy === true || zoom >= 3} onClick={() => { changeZoom(zoom + 0.1) }}><Plus size={16} /></button>
          <button type="button" className="icon-button" aria-label="重置裁剪位置" title="重置" disabled={props.busy === true || image.width <= 0} onClick={resetPosition}><RotateCcw size={15} /></button>
          <output>{Math.round(zoom * 100)}%</output>
        </div>
      </div>
      <footer className="image-crop-dialog__footer">
        <button type="button" disabled={props.busy === true} onClick={props.onCancel}>取消</button>
        <button type="button" className="primary-command" data-testid="image-crop-confirm" disabled={props.busy === true || image.width <= 0} onClick={confirm}>{props.busy === true ? "保存中…" : "使用此封面"}</button>
      </footer>
    </section>
  </div>
}
