"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
// remark-gfm and react-icons cannot be imported directly in this environment.
// They are replaced with alternatives (basic markdown and inline SVGs).

// Interface for history items
interface HistoryItem {
  prompt?: string;
  timestamp?: string;
}

// Interface for Toast notifications
interface Toast {
  message: string;
  type: "success" | "error";
}

// Helper function to get relative time for history items
function getRelativeTime(timestamp?: string) {
  if (!timestamp) return "";
  const now = new Date();
  const past = new Date(timestamp);
  const diff = Math.floor((now.getTime() - past.getTime()) / 1000);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Toast Notification Component
const ToastNotification = ({
  message,
  type,
  onDismiss,
}: {
  message: string;
  type: "success" | "error";
  onDismiss: () => void;
}) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 3000); // Auto-dismiss after 3 seconds
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const bgColor = type === "success" ? "bg-green-600" : "bg-red-600";

  return (
    <div
      className={`fixed bottom-5 right-5 ${bgColor} text-white py-3 px-6 rounded-lg shadow-xl transition-transform transform animate-slide-in`}
    >
      {message}
    </div>
  );
};

export default function BlogAgent() {
  // --- STATE MANAGEMENT ---
  const [prompt, setPrompt] = useState("");
  const [blog, setBlog] = useState("");
  const [loading, setLoading] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingStep, setLoadingStep] = useState("");
  const [streamingBlog, setStreamingBlog] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState("");
  const [currentUrl, setCurrentUrl] = useState(""); // Safely store window.location.href
  const [toast, setToast] = useState<Toast | null>(null); // For toast notifications

  const controllerRef = useRef<AbortController | null>(null);
  const editableRef = useRef<HTMLDivElement>(null);

  // --- EFFECTS ---

  useEffect(() => {
    // Create and load html2pdf.js script dynamically
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
    script.async = true;

    script.onload = () => {
      console.log("✅ html2pdf.js loaded successfully");
    };

    script.onerror = () => {
      console.error("❌ Failed to load html2pdf.js");
      setToast({ message: "PDF export script failed to load.", type: "error" });
    };

    document.body.appendChild(script);

    // Load blog history
    try {
      const saved = localStorage.getItem("blog-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch (e) {
      console.error("Failed to parse history from localStorage", e);
    }

    // Set current URL safely
    if (typeof window !== "undefined") {
      setCurrentUrl(window.location.href);
    }

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // --- CORE FUNCTIONS ---

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
  };

  // Function to generate a new suggestion based on blog content
  const generateNewSuggestion = async (blogContent: string) => {
    const suggestionPrompt = `Based on the following blog post, provide one concise, actionable suggestion for improvement that could be appended to the original prompt to generate an even better version. The suggestion should be a single sentence. Blog Post: "${blogContent.substring(
      0,
      500
    )}..."`;

    const payload = {
      contents: [{ role: "user", parts: [{ text: suggestionPrompt }] }],
    };
    const apiKey = ""; // Will be populated by the environment
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (result.candidates && result.candidates[0]?.content?.parts[0]?.text) {
        setSuggestion(result.candidates[0].content.parts[0].text.trim());
      } else {
        // Fallback suggestion
        setSuggestion('Consider adding a "Key Takeaways" section.');
      }
    } catch (error) {
      console.error("Suggestion generation failed:", error);
      // Fallback suggestion
      setSuggestion('Consider adding a "Key Takeaways" section.');
    }
  };

  const generateBlog = async () => {
    setLoading(true);
    setStreamingBlog("");
    setBlog("");
    setShowButtons(false);
    setImageUrls([]);
    setLoadingStep("");
    setSuggestion("");

    const steps = [
      "🔍 Gathering related data and references...",
      "📝 Preparing and formatting...",
      "✨ Finalizing your unique blog...",
    ];
    steps.forEach((step, i) => {
      setTimeout(() => setLoadingStep(step), 3000 + i * 5000);
    });

    controllerRef.current = new AbortController();

    try {
      const res = await fetch("http://localhost:8000/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: controllerRef.current.signal,
      });

      if (!res.ok) {
        const errorData = await res.json();
        setBlog(errorData.error || "Something went wrong. Please try again.");
        showToast(errorData.error || "Failed to generate blog.", "error");
        setLoading(false);
        return;
      }

      if (!res.body) throw new Error("No stream returned from server.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        fullText += chunk;
        setStreamingBlog((prev) => prev + chunk);
      }

      const imageJsonStartTag = "<!--IMAGE_JSON_START-->";
      const imageJsonEndTag = "<!--IMAGE_JSON_END-->";
      const startImgJson = fullText.indexOf(imageJsonStartTag);
      const endImgJson = fullText.indexOf(imageJsonEndTag);

      if (startImgJson !== -1 && endImgJson !== -1) {
        const jsonString = fullText.substring(
          startImgJson + imageJsonStartTag.length,
          endImgJson
        );
        try {
          const parsedImageUrls = JSON.parse(jsonString);
          if (Array.isArray(parsedImageUrls)) {
            setImageUrls(parsedImageUrls);
          }
        } catch (err) {
          console.error("Failed to parse image URLs from backend JSON:", err);
          showToast("Failed to load some images.", "error");
        }
        fullText =
          fullText.substring(0, startImgJson) +
          fullText.substring(endImgJson + imageJsonEndTag.length);
      }

      setBlog(fullText);
      setShowButtons(true);

      // Generate a new, dynamic suggestion
      await generateNewSuggestion(fullText);

      const newEntry = { prompt, timestamp: new Date().toISOString() };
      const updated = [
        newEntry,
        ...history.filter((h) => h.prompt !== prompt),
      ].slice(0, 10);
      setHistory(updated);
      localStorage.setItem("blog-history", JSON.stringify(updated));
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("Fetch aborted by user.");
        setBlog("Blog generation aborted.");
        showToast("Generation cancelled.", "error");
      } else {
        console.error("Streaming error:", error);
        setBlog("Something went wrong. Please try again.");
        showToast("An unexpected error occurred.", "error");
      }
    } finally {
      setLoading(false);
      controllerRef.current = null;
      setLoadingStep("");
    }
  };

  const resetChat = () => {
    setPrompt("");
    setBlog("");
    setStreamingBlog("");
    setImageUrls([]);
    setShowButtons(false);
    setLoadingStep("");
    setSuggestion("");
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  };

  const handleDownloadPDF = () => {
    const element = editableRef.current;

    if (!element) {
      showToast("No blog content to export.", "error");
      return;
    }

    // Ensure html2pdf is available after script load
    const html2pdfInstance = (window as any).html2pdf;

    if (typeof html2pdfInstance !== "function") {
      console.error("html2pdf.js is not loaded or not callable.");
      showToast("PDF generation library not loaded.", "error");
      return;
    }

    // Clone blog content safely
    const clone = element.cloneNode(true) as HTMLElement;
    clone.classList.remove('prose-invert', 'dark'); // Remove dark mode
    clone.classList.add('pdf-theme'); // Optional CSS class

    const wrapper = document.createElement("div");
    wrapper.appendChild(clone);

    html2pdfInstance()
      .set({
        margin: 0.5,
        filename: "blog.pdf",
        html2canvas: { scale: 2 },
        jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
      })
      .from(wrapper)
      .save();
  };

  const handleCopy = () => {
    const content = editableRef.current?.innerText || "";
    const textarea = document.createElement("textarea");
    textarea.value = content;
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand("copy");
      showToast("Copied to clipboard!", "success");
    } catch (err) {
      console.error("Failed to copy text: ", err);
      showToast("Failed to copy text.", "error");
    } finally {
      document.body.removeChild(textarea);
    }
  };

  // --- RENDER ---

  return (
    <div className={`${darkMode ? "dark" : ""} font-inter`}>
      {toast && (
        <ToastNotification
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
      <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-950 text-black dark:text-white">
        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-center px-4 sm:px-6 py-3 sm:py-4 bg-gray-800 border-b border-gray-700 shadow-lg rounded-b-lg">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-green-400 mb-2 sm:mb-0">
            ✨ Blog Writer Agent
          </h1>
          <div className="flex gap-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-sm sm:text-md font-semibold transition-colors duration-200 shadow-md"
            >
              {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
            </button>
            <button
              onClick={resetChat}
              className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-sm sm:text-md font-semibold transition-colors duration-200 shadow-md"
            >
              + New Blog
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
          {/* History Section */}
          <div className="w-full md:w-1/5 p-4 bg-gray-800 border-b md:border-b-0 md:border-r border-gray-700 flex flex-col justify-between overflow-y-auto min-h-[150px] md:min-h-0">
            <div>
              <h2 className="text-2xl sm:text-3xl font-semibold mb-4 text-gray-200">
                🕓 History
              </h2>
              <ul className="space-y-2">
                {history.map((item, index) => (
                  <li
                    key={index}
                    className="rounded-md overflow-hidden shadow-sm"
                  >
                    <button
                      onClick={() => {
                        resetChat();
                        setPrompt(item.prompt || "");
                      }}
                      className="block w-full text-left p-2 rounded-md text-sm sm:text-md text-green-200 bg-gray-700 hover:bg-gray-600 transition-colors duration-200"
                      title={
                        item.timestamp
                          ? new Date(item.timestamp).toLocaleString()
                          : ""
                      }
                    >
                      <span className="block truncate">
                        {(item.prompt || "").slice(0, 40)}
                        {item.prompt && item.prompt.length > 40
                          ? "..."
                          : ""} — {getRelativeTime(item.timestamp)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {/* Footer with social links */}
            <footer className="text-sm text-center text-gray-400 mt-6 pt-4 border-t border-gray-700">
              <p>© Muhammad Hamza Iqbal</p>
              <p>Email: Hamzaiqbal2890@gmail.com</p>
              <div className="flex gap-4 text-xl sm:text-2xl mb-2 mt-2 justify-center">
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                    editableRef.current?.innerText || ""
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors duration-200"
                  aria-label="Share on Twitter"
                >
                  <svg
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-6 h-6"
                  >
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.21-6.892L4.362 21.75H1.055l7.228-8.26L1.055 2.25H8.08l4.486 5.24L18.244 2.25zM16.17 19.48h1.84l-9.352-12.38H6.58l9.59 12.38z"></path>
                  </svg>
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    editableRef.current?.innerText || ""
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-400 hover:text-green-300 transition-colors duration-200"
                  aria-label="Share on WhatsApp"
                >
                  <svg
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-6 h-6"
                  >
                    <path d="M12.001 2C6.477 2 2 6.477 2 12c0 1.769.459 3.424 1.258 4.887L2 22l5.313-1.401A9.94 9.94 0 0012.001 22C17.525 22 22 17.523 22 12S17.525 2 12.001 2zM16.95 15.426c-.196-.098-.586-.289-1.172-.516-.586-.228-.857-.323-1.049.323-.19.645-.733.824-1.48.92-1.049.141-1.644-.093-2.388-.838-.93-.93-1.523-2.076-1.57-2.174-.047-.098-.857-1.144-.857-2.22s.517-1.644.71-1.882c.195-.237.39-.285.536-.285.147 0 .293.006.42.018.128.012.293.023.438.37.146.347.516 1.26.563 1.356.046.098.093.19.023.336-.07.147-.093.242-.188.341-.094.098-.19.21-.282.306-.09.094-.187.199-.093.387.093.188.42.61.883 1.074.672.672 1.215.883 1.383.953.168.07.265.07.36-.023.1-.094.444-.516.562-.684.118-.168.237-.143.417-.094.18.047.586.281 1.049.562.463.282.777.422.883.516.105.095.105.143.07.418-.034.276-.197.689-.586.92z"></path>
                  </svg>
                </a>
                <a
                  href={`https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(
                    currentUrl
                  )}&title=Check%20out%20this%20blog%20post&summary=${encodeURIComponent(
                    editableRef.current?.innerText || ""
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 hover:text-blue-200 transition-colors duration-200"
                  aria-label="Share on LinkedIn"
                >
                  <svg
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-6 h-6"
                  >
                    <path d="M20.447 20.452h-3.554v-5.567c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.665H9.351V9.49h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.296zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9.49h3.564v10.962z"></path>
                  </svg>
                </a>
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(
                    editableRef.current?.innerText || ""
                  )}&u=${encodeURIComponent(currentUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-400 transition-colors duration-200"
                  aria-label="Share on Facebook"
                >
                  <svg
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-6 h-6"
                  >
                    <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06c0 4.71 3.29 8.65 7.62 9.87v-7H7.31v-2.87h2.31V9.61c0-2.28 1.35-3.53 3.42-3.53.98 0 1.95.17 1.95.17v2.44h-1.26c-1.14 0-1.51.72-1.51 1.46v1.73h2.78l-.45 2.87h-2.33v7.02c4.33-1.22 7.62-5.16 7.62-9.87C22 6.53 17.5 2.04 12 2.04z"></path>
                  </svg>
                </a>
              </div>
            </footer>
          </div>

          {/* Prompt Input and Suggestion Section */}
          {/* Prompt Input and Suggestion Section */}
          <div className="w-full h-full md:w-1/3 p-4 bg-gray-900 flex flex-col border-b md:border-b-0 md:border-r border-gray-800 min-h-[250px] md:min-h-0">
            <h2 className="text-2xl sm:text-3xl font-semibold mb-4 text-gray-200">
              💡 Enter a Prompt
            </h2>

            <div className="flex flex-col gap-4 h-full">
              {/* Top 3/4: Prompt Input and Button */}
              <div className="flex flex-col gap-4 flex-[3]">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="flex-1 p-4 bg-gray-800 border border-gray-600 rounded-lg resize-none text-md sm:text-xl font-semibold text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-200 min-h-[120px]"
                  placeholder="E.g. Write a blog on AI in education..."
                />
                <div className="relative w-full">
                  <button
                    onClick={generateBlog}
                    disabled={!prompt.trim() || loading}
                    className={`w-full py-2 sm:py-3 pr-12 text-lg sm:text-xl font-medium transition-all duration-300 rounded-md shadow-lg ${
                      loading
                        ? "bg-green-700 text-white cursor-wait opacity-80"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {loading ? "Generating..." : "Generate Blog"}
                  </button>

                  {/* Enhanced Stop Button */}
                  {loading && (
                    <button
                      onClick={() => {
                        if (controllerRef.current)
                          controllerRef.current.abort();
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-gray-900 hover:bg-red-600 border border-red-500 text-red-500 hover:text-white rounded-md p-2 transition-all duration-200 flex items-center gap-1 shadow-lg"
                      aria-label="Cancel generation"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                      <span className="hidden sm:inline text-sm font-medium">
                        Stop
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {/* Bottom 1/4: Suggestion Section */}
              <div className="flex-1 bg-gray-800 p-4 rounded-lg text-white border border-gray-700 shadow-md flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold text-green-400 mb-2">
                    🧠 Suggestion
                  </h3>
                  <p className="text-md text-gray-300">
                    {suggestion ||
                      "Suggestions will appear here after your blog is generated."}
                  </p>
                </div>
                {suggestion && (
                  <button
                    onClick={() =>
                      setPrompt((prev) => prev + "\n\n" + suggestion)
                    }
                    className="mt-4 ml-auto bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-semibold transition-colors duration-200 shadow-md"
                  >
                    ➕ Apply Suggestion
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Blog Output Section */}
          <div className="w-full md:w-2/3 p-6 overflow-y-auto bg-gray-950 relative">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-green-300">
              📄 Generated Blog
            </h2>
            {loading && loadingStep && (
              <p className="text-gray-400 animate-pulse mb-3 text-lg">
                {loadingStep}
              </p>
            )}
            <div
              id="blog-content"
              contentEditable={!loading}
              ref={editableRef}
              suppressContentEditableWarning={true}
              className={`prose dark:prose-invert prose-lg max-w-none leading-relaxed p-4 border border-gray-800 rounded-xl bg-gray-900 shadow-lg ${
                loading ? "opacity-70 cursor-not-allowed" : "cursor-text"
              }`}
            >
              {/* The 'remarkGfm' plugin has been removed to fix the compilation error */}
              <ReactMarkdown>{loading ? streamingBlog : blog}</ReactMarkdown>
            </div>

            {imageUrls.length > 0 && (
              <div className="my-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {imageUrls.map((url, i) => (
                  <div
                    key={i}
                    className="relative rounded-lg overflow-hidden shadow-xl group"
                  >
                    <img
                      src={url}
                      alt={`Blog visual ${i + 1}`}
                      className="w-full h-48 sm:h-56 object-cover rounded-lg transform transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        e.currentTarget.src = `https://placehold.co/400x300/343434/FFFFFF?text=Image+Load+Error`;
                        e.currentTarget.alt = "Image failed to load";
                      }}
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <p className="text-white text-md font-semibold">
                        Related Image
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showButtons && (
              <div className="mt-6 flex flex-wrap gap-3 items-center justify-between">
                <div className="flex gap-3">
                  <button
                    onClick={handleDownloadPDF}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-semibold transition-colors duration-200 shadow-md"
                  >
                    📄 Download PDF
                  </button>
                  <button
                    onClick={handleCopy}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg text-sm font-semibold transition-colors duration-200 shadow-md"
                  >
                    📋 Copy
                  </button>
                </div>
                <div className="flex gap-4 text-2xl">
                  <a
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                      editableRef.current?.innerText || ""
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 transition-colors duration-200"
                    aria-label="Share on Twitter"
                  >
                    <svg
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      className="w-6 h-6"
                    >
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.21-6.892L4.362 21.75H1.055l7.228-8.26L1.055 2.25H8.08l4.486 5.24L18.244 2.25zM16.17 19.48h1.84l-9.352-12.38H6.58l9.59 12.38z"></path>
                    </svg>
                  </a>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      editableRef.current?.innerText || ""
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-400 hover:text-green-300 transition-colors duration-200"
                    aria-label="Share on WhatsApp"
                  >
                    <svg
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      className="w-6 h-6"
                    >
                      <path d="M12.001 2C6.477 2 2 6.477 2 12c0 1.769.459 3.424 1.258 4.887L2 22l5.313-1.401A9.94 9.94 0 0012.001 22C17.525 22 22 17.523 22 12S17.525 2 12.001 2zM16.95 15.426c-.196-.098-.586-.289-1.172-.516-.586-.228-.857-.323-1.049.323-.19.645-.733.824-1.48.92-1.049.141-1.644-.093-2.388-.838-.93-.93-1.523-2.076-1.57-2.174-.047-.098-.857-1.144-.857-2.22s.517-1.644.71-1.882c.195-.237.39-.285.536-.285.147 0 .293.006.42.018.128.012.293.023.438.37.146.347.516 1.26.563 1.356.046.098.093.19.023.336-.07.147-.093.242-.188.341-.094.098-.19.21-.282.306-.09.094-.187.199-.093.387.093.188.42.61.883 1.074.672.672 1.215.883 1.383.953.168.07.265.07.36-.023.1-.094.444-.516.562-.684.118-.168.237-.143.417-.094.18.047.586.281 1.049.562.463.282.777.422.883.516.105.095.105.143.07.418-.034.276-.197.689-.586.92z"></path>
                    </svg>
                  </a>
                  <a
                    href={`https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(
                      currentUrl
                    )}&title=Check%20out%20this%20blog%20post&summary=${encodeURIComponent(
                      editableRef.current?.innerText || ""
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-300 hover:text-blue-200 transition-colors duration-200"
                    aria-label="Share on LinkedIn"
                  >
                    <svg
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      className="w-6 h-6"
                    >
                      <path d="M20.447 20.452h-3.554v-5.567c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.665H9.351V9.49h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.296zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9.49h3.564v10.962z"></path>
                    </svg>
                  </a>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(
                      editableRef.current?.innerText || ""
                    )}&u=${encodeURIComponent(currentUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-400 transition-colors duration-200"
                    aria-label="Share on Facebook"
                  >
                    <svg
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      className="w-6 h-6"
                    >
                      <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06c0 4.71 3.29 8.65 7.62 9.87v-7H7.31v-2.87h2.31V9.61c0-2.28 1.35-3.53 3.42-3.53.98 0 1.95.17 1.95.17v2.44h-1.26c-1.14 0-1.51.72-1.51 1.46v1.73h2.78l-.45 2.87h-2.33v7.02c4.33-1.22 7.62-5.16 7.62-9.87C22 6.53 17.5 2.04 12 2.04z"></path>
                    </svg>
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
