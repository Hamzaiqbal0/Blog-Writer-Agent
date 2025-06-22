'use client'

import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FaTwitter, FaWhatsapp, FaLinkedin, FaFacebook } from 'react-icons/fa'

interface HistoryItem {
  prompt?: string
  timestamp?: string
}

function getRelativeTime(timestamp?: string) {
  if (!timestamp) return ''
  const now = new Date()
  const past = new Date(timestamp)
  const diff = Math.floor((now.getTime() - past.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function BlogAgent() {
  const [prompt, setPrompt] = useState('')
  const [blog, setBlog] = useState('')
  const [loading, setLoading] = useState(false)
  const [showButtons, setShowButtons] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loadingStep, setLoadingStep] = useState('')
  const [streamingBlog, setStreamingBlog] = useState('')
  const [imageKeywords, setImageKeywords] = useState<string[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('blog-history')
    if (saved) setHistory(JSON.parse(saved))
  }, [])

  const generateBlog = async () => {
    setLoading(true)
    setStreamingBlog('')
    setBlog('')
    setShowButtons(false)
    setImageKeywords([])
    setImageUrls([])
    setLoadingStep('')

    const steps = [
      '🔍 Gathering related data and references...',
      '📝 Preparing and formatting...',
      '✨ Finalizing your unique blog...'
    ]

    steps.forEach((step, i) => {
      setTimeout(() => setLoadingStep(step), 3000 + i * 5000)
    })

    controllerRef.current = new AbortController()

    try {
      const res = await fetch('http://localhost:8000/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controllerRef.current.signal,
      })

      // ✅ Handle errors returned by backend
      if (!res.ok) {
        const errorData = await res.json()
        setBlog(errorData.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      if (!res.body) throw new Error('No stream returned')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        fullText += chunk
        setStreamingBlog(prev => prev + chunk)
      }

      try {
        const match = fullText.match(/\{[\s\S]*"images"[\s\S]*\}/)
        if (match) {
          const json = JSON.parse(match[0])
          if (json.images) {
            setImageKeywords(json.images)
            fetchImagesFromPexels(json.images)
          }
          fullText = fullText.replace(match[0], '').trim()
        }
      } catch (err) {
        console.error('Image JSON parsing failed:', err)
      }

      setBlog(fullText)
      setShowButtons(true)
      const newEntry = { prompt, timestamp: new Date().toISOString() }
      const updated = [newEntry, ...history.filter(h => h.prompt !== prompt)].slice(0, 10)
      setHistory(updated)
      localStorage.setItem('blog-history', JSON.stringify(updated))
    } catch (error) {
      console.error('Streaming error:', error)
      setBlog('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
      controllerRef.current = null
    }
  }

  const fetchImagesFromPexels = async (keywords: string[]) => {
    const urls: string[] = []
    for (const keyword of keywords) {
      try {
        const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=1`, {
          headers: {
            Authorization: process.env.NEXT_PUBLIC_PEXELS_API_KEY || '',
          }
        })
        const data = await res.json()
        if (data.photos && data.photos[0]) {
          urls.push(data.photos[0].src.large)
        }
      } catch (e) {
        console.error(`Failed to fetch image for ${keyword}`, e)
      }
    }
    setImageUrls(urls)
  }

  const resetChat = () => {
    setPrompt('')
    setBlog('')
    setStreamingBlog('')
    setImageKeywords([])
    setImageUrls([])
    setShowButtons(false)
    setLoadingStep('')
  }

  const handleDownloadPDF = () => {
    const element = document.getElementById('blog-content')
    if (element) {
      const clone = element.cloneNode(true) as HTMLElement
      clone.classList.remove('prose-invert')
      clone.classList.add('pdf-theme')
      const wrapper = document.createElement('div')
      wrapper.appendChild(clone)
      import('html2pdf.js').then((html2pdf) => {
        html2pdf.default().from(wrapper).set({
          margin: 0.5,
          filename: 'blog.pdf',
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        }).save()
      })
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(blog)
      alert('Copied to clipboard!')
    } catch {
      alert('Failed to copy.')
    }
  }

  return (
    <div className={`${darkMode ? 'dark' : ''}`}>
      <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-950 text-black dark:text-white font-sans">
        <header className="flex justify-between items-center px-6 py-4 bg-gray-800 border-b border-gray-700 shadow-lg">
          <h1 className="text-4xl font-extrabold tracking-tight text-green-400">
            ✨ Blog Writer Agent
          </h1>
          <div className="flex gap-2">
            <button onClick={() => setDarkMode(!darkMode)} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-md font-semibold">
              {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
            </button>
            <button onClick={resetChat} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-md font-semibold">
              + New Chat
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/5 p-4 bg-gray-800 border-r border-gray-700 flex flex-col justify-between overflow-y-auto">
            <div>
              <h2 className="text-3xl font-semibold mb-6">🕓 History</h2>
              <ul className="space-y-2">
                {history.map((item, index) => (
                  <li key={index}>
                    <button
                      onClick={() => setPrompt(item.prompt || '')}
                      className="block w-full text-left p-2 rounded-md text-md text-green-200 bg-gray-700 hover:bg-gray-600 transition"
                      title={item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}
                    >
                      <span className="block truncate">
                        {(item.prompt || '').slice(0, 40)} — {getRelativeTime(item.timestamp)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="text-sm text-center text-gray-400 mt-6">
              <p>© Copyrights by Muhammad Hamza Iqbal</p>
              <p>Email: Hamzaiqbal2890@gmail.com</p>
              <div className="flex gap-4 text-2xl mb-2 mt-2 justify-center">
                  <a href={`https://twitter.com`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-400 transition-transform hover:scale-125">
                    <FaTwitter />
                  </a>
                  <a href={`https://wa.me`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-green-400 transition-transform hover:scale-125">
                    <FaWhatsapp />
                  </a>
                  <a href={`https://www.linkedin.com`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-300 transition-transform hover:scale-125">
                    <FaLinkedin />
                  </a>
                  <a href={`https://www.facebook.com`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-500 transition-transform hover:scale-125">
                    <FaFacebook />
                  </a>
                </div>
            </footer>
          </div>

          <div className="w-1/3 p-4 bg-gray-900 flex flex-col border-r border-gray-800">
            <h2 className="text-3xl font-semibold mb-4">💡 Enter a Prompt</h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="flex-1 p-4 bg-gray-800 border border-gray-600 rounded-lg resize-none mb-4 text-xl font-semibold text-white placeholder-gray-400"
              placeholder="E.g. Write a blog on AI in education..."
            />
            <div className="relative w-full">
  <button
    onClick={generateBlog}
    disabled={!prompt.trim() || loading}
    className={`w-full py-3 pr-12 text-xl font-medium transition-all rounded-md ${
      loading
        ? 'bg-green-600 text-white cursor-wait'
        : 'bg-green-600 hover:bg-green-700 text-white'
    }`}
  >
    {loading ? 'Generating...' : 'Generate Blog'}
  </button>

  {loading && (
    <button
      onClick={() => {
        if (controllerRef.current) controllerRef.current.abort()
      }}
      title="Stop generating"
      className="absolute right-2 top-1/2 -translate-y-1/2 text-white bg-white hover:bg-red-700 rounded-full px-3 py-3 text-sm transition-all"
    >
      <div className="w-4 h-4 bg-black" />
    </button>
  )}
</div>

          </div>

          <div className="w-2/3 p-6 overflow-y-auto bg-gray-950 relative">
            <div id="blog-content" className="prose dark:prose-invert prose-lg max-w-none">
              <h2 className="text-3xl font-bold mb-4 text-green-300">📄 Generated Blog</h2>

              {loading && loadingStep && (
                <p className="text-gray-400 animate-pulse mb-1">{loadingStep}</p>
              )}

              {!loading && streamingBlog && (
                <div className="prose dark:prose-invert prose-lg max-w-none leading-relaxed">
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      h1: ({ node, ...props }) => (
        <h1 {...props} className="text-4xl font-bold text-green-300 my-4" />
      ),
      h2: ({ node, ...props }) => (
        <h2 {...props} className="text-2xl font-semibold text-purple-400 my-2" />
      ),
      h3: ({ node, ...props }) => (
        <h3 {...props} className="text-xl font-medium text-yellow-300 my-2" />
      ),
      a: ({ node, ...props }) => (
        <a {...props} className="text-blue-400 underline hover:text-blue-300" target="_blank" />
      ),
      li: ({ node, ...props }) => (
        <li {...props} className="my-1 list-disc list-inside" />
      ),
      strong: ({ node, ...props }) => (
        <strong {...props} className="text-orange-300 font-semibold" />
      ),
      img: ({ node, ...props }) => (
        <img {...props} className="rounded shadow-md w-full max-h-80 object-cover my-4" />
      ),
      code: ({ node, ...props }) => (
        <code {...props} className="bg-gray-800 text-green-400 px-2 py-1 rounded" />
      ),
    }}
  >
    {streamingBlog}
  </ReactMarkdown>
  {loading && <span className="animate-pulse text-green-500 ml-1">▌</span>}
</div>
              )}

              {imageUrls.length > 0 && (
                <div className="my-8 grid grid-cols-2 gap-4">
                  {imageUrls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt="Blog visual"
                      className="w-full h-auto rounded shadow-md object-cover max-h-80"
                    />
                  ))}
                </div>
              )}
            </div>

            {showButtons && (
              <div className="mt-6 flex flex-wrap gap-3 items-center justify-between">
                <div className="flex gap-3">
                  <button onClick={handleDownloadPDF} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm">
                    📄 Download PDF
                  </button>
                  <button onClick={handleCopy} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm">
                    📋 Copy
                  </button>
                </div>
                <div className="flex gap-4 text-2xl">
                  <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(blog)}`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-blue-400 transition-transform hover:scale-110">
                    <FaTwitter />
                  </a>
                  <a href={`https://wa.me/?text=${encodeURIComponent(blog)}`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-green-400 transition-transform hover:scale-110">
                    <FaWhatsapp />
                  </a>
                  <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(blog)}`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-blue-300 transition-transform hover:scale-110">
                    <FaLinkedin />
                  </a>
                  <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(blog)}`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-blue-500 transition-transform hover:scale-110">
                    <FaFacebook />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
