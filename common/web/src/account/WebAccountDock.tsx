import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react"
import { createPortal } from "react-dom"
import { User, X } from "lucide-react"

import { loadWebSession } from "../bridge/session.js"
import { defaultAvatars } from "./default-avatars.js"
import { fetchCaptcha, loginWebAccount, logoutWebAccount, type CaptchaChallenge } from "./web-auth.js"

const firstAvatar = defaultAvatars[0]?.dataUrl ?? ""

export function WebAccountDock(): React.JSX.Element {
  const saved = loadWebSession()
  const signedIn = saved.accountId !== undefined && saved.apiToken.length > 0
  const [open, setOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [avatar, setAvatar] = useState(saved.avatarDataUrl ?? firstAvatar)
  const [account, setAccount] = useState(saved.accountName ?? "")
  const [password, setPassword] = useState("")
  const [captchaCode, setCaptchaCode] = useState("")
  const [captcha, setCaptcha] = useState<CaptchaChallenge | undefined>()
  const [captchaNonce, setCaptchaNonce] = useState(0)
  const [cropFile, setCropFile] = useState<File | undefined>()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("keydown", onKey) }
  }, [open])

  useEffect(() => {
    if (!open || !showForm) return undefined
    let cancelled = false
    setCaptcha(undefined)
    void fetchCaptcha(saved.apiBaseUrl).then((next) => {
      if (!cancelled) setCaptcha(next)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "验证码获取失败")
    })
    return () => { cancelled = true }
  }, [open, showForm, captchaNonce, saved.apiBaseUrl])

  function openDock(): void {
    setShowForm(!signedIn)
    setPassword("")
    setCaptchaCode("")
    setError("")
    setCropFile(undefined)
    setOpen(true)
    if (!signedIn) setCaptchaNonce((value) => value + 1)
  }

  function openForm(): void {
    setShowForm(true)
    setPassword("")
    setCaptchaCode("")
    setError("")
    setCaptchaNonce((value) => value + 1)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending || captcha === undefined) {
      if (captcha === undefined) setError("请等待验证码")
      return
    }
    if (!avatar.startsWith("data:image/")) {
      setError("请选择头像")
      return
    }
    setPending(true)
    setError("")
    try {
      await loginWebAccount({
        apiBaseUrl: saved.apiBaseUrl,
        account,
        password,
        captchaId: captcha.id,
        captchaCode,
        avatarDataUrl: avatar,
      })
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败")
      setCaptchaCode("")
      setCaptchaNonce((value) => value + 1)
      setPending(false)
    }
  }

  const button = (
    <button
      type="button"
      className="web-account-button"
      data-testid="web-account-button"
      aria-haspopup="dialog"
      aria-label={signedIn ? `账户 ${saved.accountName ?? ""}` : "登录"}
      onClick={() => { if (open) setOpen(false); else openDock() }}
    >
      {signedIn && saved.avatarDataUrl !== undefined
        ? <img alt="" src={saved.avatarDataUrl} draggable={false} />
        : <User size={18} strokeWidth={2.2} />}
    </button>
  )

  const dialog = !open ? null : showForm
    ? (
      <div className="web-account-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false) }}>
        <div className="web-account-panel" role="dialog" aria-modal="true" aria-labelledby="web-account-title" onMouseDown={(event) => { event.stopPropagation() }}>
          <div className="web-account-heading">
            <h2 id="web-account-title">{signedIn ? "切换账户" : "登录"}</h2>
            <button type="button" className="web-account-icon-button" aria-label="关闭" onClick={() => { setOpen(false) }}><X size={16} /></button>
          </div>
          <p className="web-account-hint">新账户会在验证通过后自动创建。书籍、封面和模型配置按账户分开。</p>
          {cropFile !== undefined
            ? <AvatarCrop file={cropFile} onCancel={() => { setCropFile(undefined) }} onUse={(dataUrl) => { setAvatar(dataUrl); setCropFile(undefined) }} />
            : (
              <form className="web-account-form" onSubmit={(event) => { void onSubmit(event) }}>
                <div className="web-account-preview-row">
                  <img className="web-account-preview" alt="" src={avatar} />
                  <div className="web-account-avatars">
                    <div className="web-account-choices">
                      {defaultAvatars.map((item) => (
                        <button key={item.id} type="button" className="web-account-choice" aria-label={`默认头像 ${item.id}`} aria-pressed={avatar === item.dataUrl} onClick={() => { setAvatar(item.dataUrl) }}>
                          <img alt="" src={item.dataUrl} />
                        </button>
                      ))}
                    </div>
                    <button type="button" className="web-account-upload" onClick={() => { fileRef.current?.click() }}>上传并裁剪</button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      hidden
                      data-testid="web-account-file"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ""
                        if (file === undefined) return
                        if (!file.type.startsWith("image/")) {
                          setError("请选择图片文件")
                          return
                        }
                        if (file.size > 8 * 1024 * 1024) {
                          setError("图片过大，请选择 8MB 以内的图片")
                          return
                        }
                        setError("")
                        setCropFile(file)
                      }}
                    />
                  </div>
                </div>
                <label className="web-account-field">
                  <span>账户</span>
                  <input id="web-account-name" name="username" autoComplete="username" maxLength={32} value={account} onChange={(event) => { setAccount(event.target.value) }} />
                </label>
                <label className="web-account-field">
                  <span>密码</span>
                  <input id="web-account-password" name="password" type="password" autoComplete="current-password" maxLength={72} value={password} onChange={(event) => { setPassword(event.target.value) }} />
                </label>
                <div className="web-account-captcha-row">
                  <label className="web-account-field">
                    <span>验证码</span>
                    <input id="web-account-captcha" name="captcha" autoComplete="off" maxLength={6} value={captchaCode} onChange={(event) => { setCaptchaCode(event.target.value) }} />
                  </label>
                  <button type="button" className="web-account-captcha" aria-label="换一张验证码" onClick={() => { setCaptchaNonce((value) => value + 1) }}>
                    {captcha === undefined ? <span>…</span> : <img alt="验证码" src={captcha.image} />}
                  </button>
                </div>
                {error.length > 0 ? <p className="web-account-error" role="alert">{error}</p> : null}
                <button type="submit" className="web-account-submit" data-testid="web-account-submit" disabled={pending}>{pending ? "登录中…" : "登录"}</button>
              </form>
            )}
        </div>
      </div>
    )
    : (
      <div className="web-account-scrim" onMouseDown={() => { setOpen(false) }}>
        <div className="web-account-popover" role="dialog" aria-label="账户" onMouseDown={(event) => { event.stopPropagation() }}>
          <div className="web-account-identity">
            {saved.avatarDataUrl !== undefined ? <img alt="" src={saved.avatarDataUrl} /> : null}
            <strong>{saved.accountName ?? "已登录"}</strong>
          </div>
          <p className="web-account-hint">这个账户的书籍和模型配置不会和其他账户混在一起。</p>
          <div className="web-account-actions">
            <button type="button" className="web-account-secondary" onClick={openForm}>切换账户</button>
            <button type="button" className="web-account-secondary" data-testid="web-account-logout" disabled={pending} onClick={() => { setPending(true); void logoutWebAccount(saved) }}>退出登录</button>
          </div>
        </div>
      </div>
    )

  return createPortal(<>{button}{dialog}</>, document.body)
}

function AvatarCrop({ file, onCancel, onUse }: Readonly<{ file: File, onCancel: () => void, onUse: (dataUrl: string) => void }>): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ pointerId: number, x: number, y: number, originX: number, originY: number } | null>(null)
  const [image, setImage] = useState<HTMLImageElement | undefined>()
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const next = new Image()
    next.onload = () => { setImage(next); setFailed(false) }
    next.onerror = () => { setFailed(true) }
    next.src = url
    return () => { URL.revokeObjectURL(url) }
  }, [file])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || image === undefined) return
    const size = 240
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (ctx === null) return
    const cover = Math.max(size / image.width, size / image.height) * zoom
    const width = image.width * cover
    const height = image.height * cover
    ctx.fillStyle = "#111214"
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(image, (size - width) / 2 + offset.x, (size - height) / 2 + offset.y, width, height)
  }, [image, offset, zoom])

  function confirmCrop(): void {
    const source = canvasRef.current
    if (source === null) return
    const output = document.createElement("canvas")
    output.width = 128
    output.height = 128
    const ctx = output.getContext("2d")
    if (ctx === null) return
    ctx.drawImage(source, 0, 0, 128, 128)
    const dataUrl = output.toDataURL("image/png")
    if (dataUrl.length > 120_000) {
      setFailed(true)
      return
    }
    onUse(dataUrl)
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>): void {
    const current = drag.current
    if (current === null || current.pointerId !== event.pointerId) return
    setOffset({ x: current.originX + event.clientX - current.x, y: current.originY + event.clientY - current.y })
  }

  return (
    <div className="web-account-crop">
      {failed ? <p className="web-account-error" role="alert">无法读取这张图片</p> : null}
      <div className="web-account-crop-frame">
        <canvas
          ref={canvasRef}
          aria-label="拖动图片调整头像位置"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => { drag.current = null }}
        />
        <span className="web-account-crop-ring" />
      </div>
      <p>拖动图片调整位置</p>
      <label className="web-account-field">
        <span>缩放</span>
        <input type="range" min={1} max={3} step={0.01} value={zoom} aria-label="缩放" onChange={(event) => { setZoom(Number(event.target.value)) }} />
      </label>
      <div className="web-account-crop-actions">
        <button type="button" className="web-account-secondary" onClick={onCancel}>返回</button>
        <button type="button" className="web-account-submit" disabled={image === undefined || failed} onClick={confirmCrop}>使用这张</button>
      </div>
    </div>
  )
}
