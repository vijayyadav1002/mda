import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileImage, Folder, Loader2, Search, X } from "lucide-react";
import { createGraphQLClient, getApiUrl, getAuthToken } from "~/lib/api";

const SEARCH_QUERY = `
  query Search($term: String!, $limit: Int) {
    search(term: $term, limit: $limit) {
      files {
        id
        fileName
        filePath
        mimeType
        fileSize
        thumbnailUrl
        transcodedUrl
        createdAt
        tags { id name }
      }
      folders {
        name
        path
        parentPath
      }
    }
  }
`;

export interface SearchFileResult {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: string;
  thumbnailUrl: string | null;
  transcodedUrl?: string | null;
  createdAt: string;
  tags?: { id: string; name: string }[];
}

export interface SearchFolderResult {
  name: string;
  path: string;
  parentPath: string | null;
}

interface SearchBarProps {
  onSelectFile: (file: SearchFileResult) => void;
  onSelectFolder: (folder: SearchFolderResult) => void;
  className?: string;
  placeholder?: string;
}

const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 20;

export function SearchBar({
  onSelectFile,
  onSelectFolder,
  className,
  placeholder = "Search files and folders…",
}: SearchBarProps) {
  const apiUrl = getApiUrl();
  const [term, setTerm] = useState("");
  const [files, setFiles] = useState<SearchFileResult[]>([]);
  const [folders, setFolders] = useState<SearchFolderResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeqRef = useRef(0);

  const flatResults = useMemo(
    () => [
      ...folders.map((f) => ({ kind: "folder" as const, value: f })),
      ...files.map((f) => ({ kind: "file" as const, value: f })),
    ],
    [files, folders]
  );

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const clearSearch = useCallback(() => {
    setTerm("");
    setFiles([]);
    setFolders([]);
    setActiveIndex(-1);
    setOpen(false);
  }, []);

  useEffect(() => {
    const trimmed = term.trim();
    if (!trimmed) {
      setFiles([]);
      setFolders([]);
      setLoading(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    const handle = window.setTimeout(async () => {
      const token = getAuthToken();
      if (!token) {
        if (seq === requestSeqRef.current) setLoading(false);
        return;
      }
      try {
        const client = createGraphQLClient(token);
        const data: any = await client.request(SEARCH_QUERY, { term: trimmed, limit: RESULT_LIMIT });
        if (seq !== requestSeqRef.current) return;
        setFiles((data?.search?.files ?? []) as SearchFileResult[]);
        setFolders((data?.search?.folders ?? []) as SearchFolderResult[]);
        setOpen(true);
        setActiveIndex(-1);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        console.error("Search failed:", err);
        setFiles([]);
        setFolders([]);
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [term]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeDropdown]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable;
      if (isEditable) return;
      if (e.key !== "/") return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (term) {
        clearSearch();
      } else {
        closeDropdown();
        inputRef.current?.blur();
      }
      return;
    }
    if (!open || flatResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((idx) => (idx + 1) % flatResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => (idx <= 0 ? flatResults.length - 1 : idx - 1));
    } else if (e.key === "Enter") {
      const target = activeIndex >= 0 ? flatResults[activeIndex] : flatResults[0];
      if (target) {
        e.preventDefault();
        if (target.kind === "folder") {
          onSelectFolder(target.value);
        } else {
          onSelectFile(target.value);
        }
        clearSearch();
      }
    }
  };

  const showEmptyState =
    open && term.trim().length > 0 && !loading && flatResults.length === 0;

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`.trim()}>
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => {
            if (flatResults.length > 0 || term.trim().length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Search files and folders"
          className="w-full pl-9 pr-9 py-2 rounded-xl bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-primary/30 transition-all"
        />
        {term && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {!term && (
          <span className="absolute right-3 hidden md:flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <kbd className="px-1.5 py-0.5 rounded border border-border/30 font-mono">/</kbd>
          </span>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border/20 rounded-xl shadow-ambient z-50 max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Searching…
            </div>
          )}

          {showEmptyState && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">No matches for “{term.trim()}”.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Try a shorter or different term.</p>
            </div>
          )}

          {!loading && folders.length > 0 && (
            <div className="py-1">
              <p className="px-4 pt-2 pb-1 label-meta">Folders</p>
              {folders.map((folder, i) => {
                const idx = i;
                const isActive = activeIndex === idx;
                return (
                  <button
                    key={folder.path}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onSelectFolder(folder);
                      clearSearch();
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isActive ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center flex-shrink-0">
                      <Folder className="w-4 h-4 text-[#060e20]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{folder.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {folder.parentPath || folder.path}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!loading && files.length > 0 && (
            <div className="py-1 border-t border-border/10">
              <p className="px-4 pt-2 pb-1 label-meta">Files</p>
              {files.map((file, i) => {
                const idx = folders.length + i;
                const isActive = activeIndex === idx;
                const isImage = file.mimeType.startsWith("image");
                return (
                  <button
                    key={file.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onSelectFile(file);
                      clearSearch();
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isActive ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                      {file.thumbnailUrl ? (
                        <img
                          src={`${apiUrl}${file.thumbnailUrl}`}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileImage className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{file.fileName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {isImage ? "Image" : "Video"} · {file.filePath}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
