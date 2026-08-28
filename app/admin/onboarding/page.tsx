"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { touchMetadata, getOrFetchCollection } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Course, Chapter, MCQQuestion, CourseRating, QnAItem, AppFile } from "@/lib/types";
import { recalculateCourseProgress, getBase64Image } from "@/lib/utils";
import { logUserActivity } from "@/lib/activityLogger";
import * as XLSX from "xlsx";
import {
  GraduationCap,
  Plus,
  BarChart3,
  Trash2,
  Edit2,
  Save,
  ArrowLeft,
  X,
  BookOpen,
  HelpCircle,
  Award,
  Star,
  Paperclip,
  Upload,
  Download,
  CheckCircle2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Video,
  Palette,
  Highlighter,
  Eraser,
  FileSpreadsheet,
  Layers,
  Search,
  ExternalLink,
  Check,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from "lucide-react";

export default function AdminOnboardingPage() {
  const { user, userProfile } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [courses, setCourses] = useState<Course[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [dbFiles, setDbFiles] = useState<AppFile[]>([]);
  const [dbQAs, setDbQAs] = useState<QnAItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Mode: 'table' | 'editor' | 'analytics'
  const [viewMode, setViewMode] = useState<"table" | "editor" | "analytics">("table");

  // Active Editor State
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [editorCourse, setEditorCourse] = useState<Course>({
    id: "",
    title: "",
    category: "General",
    phase: 1,
    coverImage: "",
    chapters: [],
    finalQuiz: [],
    ratings: [],
    active: true,
  });
  const [editorTab, setEditorTab] = useState<number | "final" | "reviews">(-1); // -1 = Overview, 0..N-1 = Chapter
  const [savingCourse, setSavingCourse] = useState(false);

  // Category custom input state
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState("");

  // Cover image uploading status
  const [uploadingCover, setUploadingCover] = useState(false);

  // Rich Text Editor State & Ref
  const editorRef = useRef<HTMLDivElement>(null);
  const [toolbarState, setToolbarState] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    alignLeft: false,
    alignCenter: false,
    alignRight: false,
    alignJustify: false,
    unorderedList: false,
    orderedList: false,
  });

  // Rich Text Editor Media Modal (Image / Link / Video)
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const [mediaType, setMediaType] = useState<"image" | "link" | "video">("image");
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [mediaLinkText, setMediaLinkText] = useState("");
  const [uploadingEditorImage, setUploadingEditorImage] = useState(false);
  const savedSelectionRef = useRef<Range | null>(null);

  // List Starting Point Modal
  const [listStartModalOpen, setListStartModalOpen] = useState(false);
  const [listStartValue, setListStartValue] = useState("1");

  // Q&A Selector Modal inside Chapter
  const [qnaModalOpen, setQnaModalOpen] = useState(false);
  const [qnaSearch, setQnaSearch] = useState("");
  const [selectedQnaIds, setSelectedQnaIds] = useState<Set<string>>(new Set());

  // Attach Files Modal
  const [attachModalOpen, setAttachModalOpen] = useState(false);

  // Manage Agent Progress Modal
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);

  // File input refs
  const bulkUploadChapterRef = useRef<HTMLInputElement>(null);
  const bulkUploadFinalRef = useRef<HTMLInputElement>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const editorImageFileInputRef = useRef<HTMLInputElement>(null);

  // 1. Fetch Courses, Real-Time Users onSnapshot, Q&A, and Files
  useEffect(() => {
    let isMounted = true;

    // Real-time courses listener - sorted descending (newest on top)
    const unsubCourses = onSnapshot(
      collection(db, "onboardings"),
      (snap) => {
        const list: Course[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Course, "id">) }));
        
        // Sort descending: newest courses at the top
        list.sort((a, b) => {
          const idA = parseInt((a.id || "").replace(/\D/g, "")) || 0;
          const idB = parseInt((b.id || "").replace(/\D/g, "")) || 0;
          if (idA !== idB) return idB - idA;
          return ((b as any).createdAt || 0) - ((a as any).createdAt || 0);
        });

        if (isMounted) {
          setCourses(list);
          setLoading(false);
        }
      },
      (err) => console.error("Onboarding sync error:", err)
    );

    // Real-time users listener (Live sync for progress and analytics!)
    const unsubUsers = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            email: (data.email || d.id || "").toLowerCase(),
            displayName: data.displayName || data.name || (data.email || d.id || "").split("@")[0],
            ...data,
          });
        });
        if (isMounted) {
          setUsers(list);
        }
      },
      (err) => console.error("Users live sync error:", err)
    );

    // Fetch Files and Q&A
    const fetchExtra = async () => {
      try {
        const [fList, qList] = await Promise.all([
          getOrFetchCollection<AppFile>("files"),
          getOrFetchCollection<QnAItem>("qna"),
        ]);

        if (isMounted) {
          setDbFiles(fList);
          setDbQAs(qList);
        }
      } catch (e) {
        console.error("Error loading onboarding extras:", e);
      }
    };
    fetchExtra();

    return () => {
      isMounted = false;
      unsubCourses();
      unsubUsers();
    };
  }, []);

  // Collect all unique categories
  const allCategories = useMemo(() => {
    const defaultCats = ["General", "Operations", "Compliance", "Underwriting", "Claims", "Inspection"];
    const cats = new Set(defaultCats);
    courses.forEach((c) => {
      if (c.category?.trim()) cats.add(c.category.trim());
    });
    return Array.from(cats);
  }, [courses]);

  // Metrics
  const { activeCount, totalChapters, totalPhases } = useMemo(() => {
    let active = 0;
    let chapters = 0;
    const phaseSet = new Set<number>();

    courses.forEach((c) => {
      if (c.active) active++;
      chapters += c.chapters?.length || 0;
      phaseSet.add(c.phase || 1);
    });

    return {
      activeCount: active,
      totalChapters: chapters,
      totalPhases: phaseSet.size,
    };
  }, [courses]);

  // Unified calculation helper for agent progress to ensure table & modal match 100%
  const calculateAgentStats = (agentUser: any, activeCoursesList: Course[]) => {
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let sumScore = 0;
    let scoredCount = 0;

    const progData = agentUser?.courseProgress || {};

    activeCoursesList.forEach((c) => {
      const rawProg = progData[c.id];
      if (rawProg) {
        const p = recalculateCourseProgress(c, rawProg);
        if (p.status === "completed") {
          completed++;
        } else if (p.status === "in-progress") {
          inProgress++;
        } else {
          notStarted++;
        }

        if (p.chapterScores) {
          Object.values(p.chapterScores).forEach((sc) => {
            if (typeof sc === "number" && !isNaN(sc)) {
              sumScore += sc;
              scoredCount++;
            }
          });
        }
        if (typeof p.finalScore === "number" && !isNaN(p.finalScore)) {
          sumScore += p.finalScore;
          scoredCount++;
        }
      } else {
        notStarted++;
      }
    });

    const avgScore = scoredCount > 0 ? Math.round(sumScore / scoredCount) : 0;
    return { completed, inProgress, notStarted, avgScore };
  };

  // Overall Agent Analytics
  const agentAnalytics = useMemo(() => {
    const activeCourses = courses.filter((c) => c.active);

    return users.map((u) => {
      const stats = calculateAgentStats(u, activeCourses);
      const userEmail = (u.email || u.id || "").toLowerCase();

      return {
        ...u,
        email: userEmail,
        completed: stats.completed,
        inProgress: stats.inProgress,
        avgScore: stats.avgScore,
      };
    });
  }, [users, courses]);

  // Live stats of currently selected agent in modal
  const liveSelectedAgentStats = useMemo(() => {
    if (!selectedAgent) return { completed: 0, inProgress: 0, notStarted: 0, avgScore: 0 };
    const agentEmail = (selectedAgent.email || selectedAgent.id || "").toLowerCase();
    const liveUser = users.find((u) => (u.email || u.id || "").toLowerCase() === agentEmail) || selectedAgent;
    const activeCourses = courses.filter((c) => c.active);
    return calculateAgentStats(liveUser, activeCourses);
  }, [selectedAgent, users, courses]);

  // Sync editor content when switching chapter tabs
  useEffect(() => {
    if (typeof editorTab === "number" && editorTab >= 0 && editorRef.current) {
      const currentHtml = editorCourse.chapters[editorTab]?.content || "";
      if (editorRef.current.innerHTML !== currentHtml) {
        editorRef.current.innerHTML = currentHtml;
      }
      updateToolbarState();
    }
  }, [editorTab]);

  // Update Toolbar formatting state on selection / key events
  const updateToolbarState = () => {
    if (typeof document === "undefined") return;
    try {
      setToolbarState({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
        alignLeft: document.queryCommandState("justifyLeft"),
        alignCenter: document.queryCommandState("justifyCenter"),
        alignRight: document.queryCommandState("justifyRight"),
        alignJustify: document.queryCommandState("justifyFull"),
        unorderedList: document.queryCommandState("insertUnorderedList"),
        orderedList: document.queryCommandState("insertOrderedList"),
      });
    } catch {
      // Ignore if document selection is inactive
    }
  };

  // Handle Input in the ContentEditable div
  const handleEditorInput = () => {
    if (editorRef.current && typeof editorTab === "number" && editorTab >= 0) {
      const html = editorRef.current.innerHTML;
      setEditorCourse((prev) => {
        const copy = [...prev.chapters];
        if (copy[editorTab]) {
          copy[editorTab] = { ...copy[editorTab], content: html };
        }
        return { ...prev, chapters: copy };
      });
    }
    updateToolbarState();
  };

  // Handle Click on embedded Q&A delete button inside editor
  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("embedded-qa-delete") || target.closest(".embedded-qa-delete")) {
      const block = target.closest(".embedded-qa-block");
      if (block) {
        block.remove();
        handleEditorInput();
      }
    }
    updateToolbarState();
  };

  // Toggle Active
  const handleToggleActive = async (c: Course) => {
    try {
      await updateDoc(doc(db, "onboardings", c.id), { active: !c.active });
      await touchMetadata("onboarding");
      toast.info(`Course ${!c.active ? "activated" : "deactivated"}.`);
    } catch (e: any) {
      toast.error("Failed to update status: " + e.message);
    }
  };

  // Launch Editor
  const handleOpenEditor = (course?: Course) => {
    if (course) {
      setActiveCourseId(course.id);
      setEditorCourse({ ...course });
      const isKnown = allCategories.includes(course.category || "General");
      setIsCustomCategory(!isKnown);
      setCustomCategoryInput(!isKnown ? course.category || "" : "");
    } else {
      setActiveCourseId(null);
      setEditorCourse({
        id: "",
        title: "",
        category: "General",
        phase: 1,
        coverImage: "",
        chapters: [{ title: "Introduction", content: "", questions: [], attachedFiles: [] }],
        finalQuiz: [],
        ratings: [],
        active: true,
      });
      setIsCustomCategory(false);
      setCustomCategoryInput("");
    }
    setEditorTab(-1);
    setViewMode("editor");
  };

  // Add Chapter
  const handleAddChapter = () => {
    setEditorCourse((prev) => ({
      ...prev,
      chapters: [
        ...(prev.chapters || []),
        {
          title: "Chapter " + ((prev.chapters?.length || 0) + 1),
          content: "",
          questions: [],
          attachedFiles: [],
        },
      ],
    }));
    setEditorTab((editorCourse.chapters?.length || 0));
  };

  // Remove Current Chapter
  const handleRemoveChapter = async (idx: number) => {
    const confirmed = await showConfirm({
      title: "Remove Chapter?",
      message: "Are you sure you want to remove this chapter from the course?",
      isDestructive: true,
      confirmText: "Remove Chapter",
    });
    if (!confirmed) return;

    setEditorCourse((prev) => {
      const copy = [...(prev.chapters || [])];
      copy.splice(idx, 1);
      return { ...prev, chapters: copy };
    });
    setEditorTab(-1);
    toast.info("Chapter removed.");
  };

  // Switch Editor Tab
  const handleSwitchTab = (newTab: number | "final" | "reviews") => {
    setEditorTab(newTab);
  };

  // Save Full Course to Firestore
  const handleSaveCourse = async () => {
    if (!editorCourse.title.trim()) {
      toast.warning("Please provide a Course Title in the Overview tab.");
      setEditorTab(-1);
      return;
    }

    setSavingCourse(true);
    const resolvedCategory = isCustomCategory
      ? customCategoryInput.trim() || "General"
      : editorCourse.category || "General";

    const payload = {
      title: editorCourse.title.trim(),
      category: resolvedCategory,
      phase: Number(editorCourse.phase) || 1,
      coverImage: editorCourse.coverImage || "",
      chapters: editorCourse.chapters || [],
      finalQuiz: editorCourse.finalQuiz || [],
      ratings: editorCourse.ratings || [],
      active: true,
      updatedAt: Date.now(),
    };

    try {
      if (activeCourseId) {
        await setDoc(doc(db, "onboardings", activeCourseId), payload, { merge: true });
        logUserActivity(user?.email, {
          desc: `Updated course: "${editorCourse.title.trim()}"`,
          type: "edit",
        });
      } else {
        const nextNum =
          Math.max(0, ...courses.map((c) => Number(c.id.replace(/\D/g, "")) || 0)) + 1;
        const newId = "COU" + String(nextNum).padStart(2, "0");

        await setDoc(doc(db, "onboardings", newId), {
          ...payload,
          date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          createdAt: Date.now(),
        });
        logUserActivity(user?.email, {
          desc: `Published new course: "${editorCourse.title.trim()}"`,
          type: "add",
        });
      }

      await touchMetadata("onboarding");
      setViewMode("table");
      toast.success("Course saved successfully!");
    } catch (err: any) {
      toast.error("Save error: " + err.message);
    } finally {
      setSavingCourse(false);
    }
  };

  // Delete Course
  const handleDeleteCourse = async (id: string) => {
    const target = courses.find((c) => c.id === id);
    const confirmed = await showConfirm({
      title: "Delete Course?",
      message: "Permanently delete Course #" + id + "?",
      isDestructive: true,
      confirmText: "Delete Course",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "onboardings", id));
      await touchMetadata("onboarding");
      logUserActivity(user?.email, {
        desc: `Deleted course: "${target?.title || `Course #${id}`}"`,
        type: "delete",
      });
      toast.success("Course #" + id + " deleted.");
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  };

  // Delete Agent's Progress on a course (Manage Progress modal action)
  const handleResetAgentProgress = async (email: string, courseId: string) => {
    const normalizedEmail = email.toLowerCase();
    const confirmed = await showConfirm({
      title: "Delete Agent Progress?",
      message: "Are you sure you want to delete this agent's progress for this course? They will have to start that course from Chapter 1 again.",
      isDestructive: true,
      confirmText: "Yes, Delete",
    });
    if (!confirmed) return;

    try {
      const userRef = doc(db, "users", normalizedEmail);
      await updateDoc(userRef, {
        ["courseProgress." + courseId]: deleteField(),
      });
      logUserActivity(user?.email, {
        desc: `Reset/Deleted course progress for agent: ${email} on Course #${courseId}`,
        type: "delete",
      });
      toast.success("Agent progress deleted successfully!");
    } catch (e: any) {
      toast.error("Failed to delete progress: " + e.message);
    }
  };

  // Cover Image Upload Handler
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingCover(true);
    try {
      const dataUri = await getBase64Image(file, 900, 0.8);
      setEditorCourse((prev) => ({ ...prev, coverImage: dataUri }));
      toast.success("Cover image processed and attached!");
    } catch (err: any) {
      toast.error("Failed to upload image: " + err.message);
    } finally {
      setUploadingCover(false);
      e.target.value = "";
    }
  };

  // --- RICH TEXT FORMATTING EXEC COMMANDS ---
  const execCmd = (cmd: string, val: string | undefined = undefined) => {
    document.execCommand(cmd, false, val);
    if (editorRef.current) {
      editorRef.current.focus();
    }
    handleEditorInput();
    updateToolbarState();
  };

  const createCustomList = (type: string) => {
    document.execCommand("insertOrderedList", false);
    const sel = window.getSelection();
    let node = sel?.anchorNode as HTMLElement | null;
    while (node && node.nodeName !== "OL" && node.id !== "richEditorArea") {
      node = node.parentElement;
    }
    if (node && node.nodeName === "OL") {
      (node as HTMLOListElement).type = type;
    }
    if (editorRef.current) {
      editorRef.current.focus();
    }
    handleEditorInput();
    updateToolbarState();
  };

  const handleApplyListStart = () => {
    const startStr = listStartValue.trim();
    if (!startStr) {
      setListStartModalOpen(false);
      return;
    }

    const sel = window.getSelection();
    let node = sel?.anchorNode as HTMLElement | null;
    while (node && node.nodeName !== "OL" && node.id !== "richEditorArea") {
      node = node.parentElement;
    }
    if (node && node.nodeName === "OL") {
      if (isNaN(Number(startStr))) {
        const val = startStr.toLowerCase().charCodeAt(0) - 96;
        if (val > 0 && val < 27) (node as HTMLOListElement).start = val;
      } else {
        (node as HTMLOListElement).start = parseInt(startStr);
      }
      handleEditorInput();
    } else {
      toast.info("Please place your cursor inside a numbered list first.");
    }
    setListStartModalOpen(false);
  };

  // Open Media Modal (Image, Link, Video)
  const openMediaInsert = (type: "image" | "link" | "video") => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0);
    }
    setMediaType(type);
    setMediaUrlInput("");
    setMediaLinkText("");
    setMediaModalOpen(true);
  };

  // Confirm Media Insertion
  const handleConfirmMediaInsert = () => {
    if (!mediaUrlInput.trim()) {
      toast.warning("Please enter a valid URL.");
      return;
    }

    if (editorRef.current) {
      editorRef.current.focus();
    }

    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedSelectionRef.current);
    }

    if (mediaType === "image") {
      const imgHtml = '<img src="' + mediaUrlInput.trim() + '" alt="Chapter Image" style="max-width: 100%; border-radius: 12px; margin: 16px auto; display: block; box-shadow: 0 4px 16px rgba(0,0,0,0.08);" /><p><br></p>';
      document.execCommand("insertHTML", false, imgHtml);
    } else if (mediaType === "link") {
      const textToUse = mediaLinkText.trim() || mediaUrlInput.trim();
      const linkHtml = '<a href="' + mediaUrlInput.trim() + '" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; font-weight: 600;">' + textToUse + '</a>';
      document.execCommand("insertHTML", false, linkHtml);
    } else if (mediaType === "video") {
      const match = mediaUrlInput.match(
        /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))((\w|-){11})/
      );
      if (match) {
        const embedHtml = '<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 12px; margin: 16px 0; box-shadow: 0 4px 16px rgba(0,0,0,0.08);"><iframe src="https://www.youtube.com/embed/' + match[1] + '" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allowfullscreen></iframe></div><p><br></p>';
        document.execCommand("insertHTML", false, embedHtml);
      } else {
        toast.error("Invalid YouTube Link. Please check the URL.");
        return;
      }
    }

    handleEditorInput();
    setMediaModalOpen(false);
  };

  // Editor Image Direct PC Upload
  const handleEditorImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingEditorImage(true);
    try {
      const dataUri = await getBase64Image(file, 900, 0.8);
      setMediaUrlInput(dataUri);
      toast.success("Image processed and ready to insert!");
    } catch (err: any) {
      toast.error("Image processing error: " + err.message);
    } finally {
      setUploadingEditorImage(false);
      e.target.value = "";
    }
  };

  // Open Q&A Selector modal and remember caret position
  const handleOpenQnAModal = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0);
    }
    setQnaSearch("");
    setSelectedQnaIds(new Set());
    setQnaModalOpen(true);
  };

  // Insert Selected Q&A blocks into chapter content at exact caret position without stacking
  const handleInsertSelectedQnAs = () => {
    if (selectedQnaIds.size === 0 || typeof editorTab !== "number" || editorTab < 0) return;

    if (editorRef.current) {
      editorRef.current.focus();
    }

    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedSelectionRef.current);
    }

    // Check if selection is currently nested inside an existing .embedded-qa-block
    const sel = window.getSelection();
    if (sel && sel.anchorNode) {
      let node: HTMLElement | null =
        sel.anchorNode.nodeType === 1 ? (sel.anchorNode as HTMLElement) : sel.anchorNode.parentElement;
      const existingBlock = node?.closest(".embedded-qa-block");
      if (existingBlock && existingBlock.parentNode) {
        // Place range right after the existing block to avoid nesting
        const newRange = document.createRange();
        newRange.setStartAfter(existingBlock);
        newRange.setEndAfter(existingBlock);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    }

    // Generate separate independent blocks for each selected Q&A
    let allHtml = "";
    selectedQnaIds.forEach((id) => {
      const qa = dbQAs.find((item) => item.id === id);
      if (qa) {
        allHtml += `
          <div class="embedded-qa-block" contenteditable="false" style="background: #f8faff; border: 1px solid #dbeafe; border-left: 4px solid #2563eb; border-radius: 12px; padding: 16px 20px; margin: 16px 0; position: relative; user-select: text;">
            <button type="button" class="embedded-qa-delete" style="position: absolute; top: 10px; right: 12px; font-size: 18px; line-height: 1; color: #94a3b8; background: transparent; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px;" title="Remove this Q&A">×</button>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              <span style="background: #2563eb; color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 700;">${qa.qaCode || "QA"}</span>
              <span style="background: #eff6ff; color: #1d4ed8; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 600;">${qa.category || "General"}</span>
            </div>
            <div style="font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 6px;">${qa.question}</div>
            <div style="font-size: 13px; color: #475569; line-height: 1.6;">${qa.answer || ""}</div>
          </div>
          <p><br></p>
        `;
      }
    });

    document.execCommand("insertHTML", false, allHtml);
    handleEditorInput();

    setQnaModalOpen(false);
    setSelectedQnaIds(new Set());
    toast.success("Q&A card inserted into chapter!");
  };

  // --- EXCEL MCQ BULK TEMPLATE & UPLOAD ---
  const downloadOnboardQuizTemplate = () => {
    const headers = [
      ["Question Text", "Option 1", "Option 2", "Option 3", "Option 4", "Correct Option (1-4)"],
    ];
    const sampleData = [
      [
        "What is the primary objective of this chapter?",
        "To understand guidelines",
        "To skip inspection",
        "To delay visits",
        "None of the above",
        1,
      ],
      [
        "Which module covers KYC compliance?",
        "Module 1",
        "Module 2",
        "Module 3",
        "Module 4",
        2,
      ],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([...headers, ...sampleData]);
    ws["!cols"] = [{ wch: 45 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 20 }];

    XLSX.utils.book_append_sheet(wb, ws, "Quiz Template");
    XLSX.writeFile(wb, "Onboarding_MCQ_Template.xlsx");
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>, target: "chapter" | "final") => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any>(worksheet, { defval: "" });

        if (rows.length === 0) {
          toast.warning("The uploaded file is empty.");
          e.target.value = "";
          return;
        }

        const newQuestions: MCQQuestion[] = [];

        rows.forEach((row) => {
          const qText = row["Question Text"] || row["question text"] || row["Question"];
          if (qText) {
            newQuestions.push({
              text: qText.toString().trim(),
              options: [
                (row["Option 1"] || "").toString().trim(),
                (row["Option 2"] || "").toString().trim(),
                (row["Option 3"] || "").toString().trim(),
                (row["Option 4"] || "").toString().trim(),
              ],
              correct: parseInt(row["Correct Option (1-4)"]) || 1,
            });
          }
        });

        if (newQuestions.length > 0) {
          if (target === "chapter" && typeof editorTab === "number" && editorTab >= 0) {
            setEditorCourse((prev) => {
              const copy = [...prev.chapters];
              const curr = copy[editorTab].questions || [];
              copy[editorTab] = { ...copy[editorTab], questions: [...curr, ...newQuestions] };
              return { ...prev, chapters: copy };
            });
          } else if (target === "final") {
            setEditorCourse((prev) => ({
              ...prev,
              finalQuiz: [...(prev.finalQuiz || []), ...newQuestions],
            }));
          }
          toast.success(`Successfully imported ${newQuestions.length} questions from Excel!`);
        } else {
          toast.error("No valid questions found in the file. Check column headers.");
        }
      } catch (err) {
        console.error(err);
        toast.error("Failed to parse Excel file.");
      }
      e.target.value = "";
    };
    reader.readAsArrayBuffer(file);
  };

  // Delete Course Feedback Review from Editor
  const handleDeleteReviewInEditor = (email: string) => {
    setEditorCourse((prev) => ({
      ...prev,
      ratings: (prev.ratings || []).filter((r) => r.email?.toLowerCase() !== email.toLowerCase()),
    }));
    toast.info("Review removed from this course.");
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <style jsx global>{`
        #richEditorArea ol {
          list-style-type: decimal;
          margin-left: 28px;
          margin-top: 8px;
          margin-bottom: 8px;
        }
        #richEditorArea ol[type="a"] {
          list-style-type: lower-alpha;
        }
        #richEditorArea ol[type="A"] {
          list-style-type: upper-alpha;
        }
        #richEditorArea ul {
          list-style-type: disc;
          margin-left: 28px;
          margin-top: 8px;
          margin-bottom: 8px;
        }
        #richEditorArea li {
          margin-bottom: 4px;
          padding-left: 4px;
        }
        #richEditorArea img {
          max-width: 100%;
          border-radius: 12px;
          margin: 16px auto;
          display: block;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
        }
        #richEditorArea iframe {
          width: 100%;
          aspect-ratio: 16 / 9;
          border-radius: 12px;
          margin: 16px 0;
        }
        #richEditorArea a {
          color: #2563eb;
          text-decoration: underline;
          font-weight: 600;
        }
        .embedded-qa-delete:hover {
          color: #ef4444 !important;
          background: #fee2e2 !important;
        }
      `}</style>

      {/* ----------------------------------------------------
          VIEW 1: COURSE EDITOR WORKSPACE
          ---------------------------------------------------- */}
      {viewMode === "editor" ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode("table")}
                className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl"
                title="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  {activeCourseId ? "Edit Course #" + activeCourseId : "Create New Course"}
                </h2>
                <p className="text-xs text-slate-500">Design chapters, content, and quizzes.</p>
              </div>
            </div>

            <button
              onClick={handleSaveCourse}
              disabled={savingCourse}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{savingCourse ? "Saving..." : "Save Course"}</span>
            </button>
          </div>

          {/* Pill navigation for Editor */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none select-none">
            <button
              onClick={() => handleSwitchTab(-1)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                editorTab === -1
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Overview
            </button>

            {editorCourse.chapters?.map((ch, idx) => (
              <button
                key={idx}
                onClick={() => handleSwitchTab(idx)}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                  editorTab === idx
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>{"Chapter " + (idx + 1)}</span>
              </button>
            ))}

            <button
              onClick={handleAddChapter}
              className="px-3 py-2 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Chapter</span>
            </button>

            <button
              onClick={() => handleSwitchTab("final")}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                editorTab === "final"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Final Assessment</span>
            </button>

            <button
              onClick={() => handleSwitchTab("reviews")}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                editorTab === "reviews"
                  ? "bg-amber-600 text-white shadow-sm"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Star className="w-3.5 h-3.5" />
              <span>Feedback & Ratings</span>
            </button>
          </div>

          {/* TAB CONTENT AREA */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-6">
            {/* 1. OVERVIEW TAB */}
            {editorTab === -1 && (
              <div className="space-y-6">
                <h3 className="font-bold text-slate-900 text-base border-b border-slate-100 pb-3">
                  Course Parameters
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Course Title *
                    </label>
                    <input
                      type="text"
                      value={editorCourse.title}
                      onChange={(e) => setEditorCourse((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="e.g. Complete Underwriting & Inspection Protocol"
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50/50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Phase (1 - 15)
                    </label>
                    <select
                      value={editorCourse.phase}
                      onChange={(e) =>
                        setEditorCourse((prev) => ({ ...prev, phase: Number(e.target.value) }))
                      }
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50/50 border border-slate-200 rounded-xl outline-none font-bold text-slate-800"
                    >
                      {Array.from({ length: 15 }).map((_, i) => (
                        <option key={i + 1} value={i + 1}>
                          Phase {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Category Dropdown + Add Category Option */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Category
                    </label>
                    <div className="space-y-2">
                      <select
                        value={isCustomCategory ? "_custom_" : editorCourse.category || "General"}
                        onChange={(e) => {
                          if (e.target.value === "_custom_") {
                            setIsCustomCategory(true);
                          } else {
                            setIsCustomCategory(false);
                            setEditorCourse((prev) => ({ ...prev, category: e.target.value }));
                          }
                        }}
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50/50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                      >
                        {allCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                        <option value="_custom_" className="font-bold text-blue-600">
                          + Add New Category
                        </option>
                      </select>

                      {isCustomCategory && (
                        <input
                          type="text"
                          value={customCategoryInput}
                          onChange={(e) => {
                            setCustomCategoryInput(e.target.value);
                            setEditorCourse((prev) => ({ ...prev, category: e.target.value }));
                          }}
                          placeholder="Type new category name..."
                          className="w-full px-3.5 py-2 text-xs bg-blue-50/30 border border-blue-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                        />
                      )}
                    </div>
                  </div>

                  {/* Cover Image URL / Google Drive Upload */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Cover Image URL or Upload
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editorCourse.coverImage}
                        onChange={(e) =>
                          setEditorCourse((prev) => ({ ...prev, coverImage: e.target.value }))
                        }
                        placeholder="https://images.unsplash.com/... or upload"
                        className="flex-1 px-3.5 py-2.5 text-xs bg-slate-50/50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => coverFileInputRef.current?.click()}
                        disabled={uploadingCover}
                        className="px-3.5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors shadow-2xs"
                        title="Upload Image from PC"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{uploadingCover ? "Processing..." : "Upload"}</span>
                      </button>
                    </div>

                    <input
                      ref={coverFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleCoverUpload}
                    />

                    {editorCourse.coverImage && (
                      <div className="mt-3 flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                        <img
                          src={editorCourse.coverImage}
                          alt="Cover Preview"
                          className="w-16 h-12 object-cover rounded-lg border border-slate-200"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-slate-800">Cover Image Attached</div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {editorCourse.coverImage.startsWith("data:")
                              ? "Local compressed image URI"
                              : editorCourse.coverImage}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditorCourse((prev) => ({ ...prev, coverImage: "" }))}
                          className="p-1 text-slate-400 hover:text-rose-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 2. CHAPTER TAB */}
            {typeof editorTab === "number" && editorTab >= 0 && (
              (() => {
                const ch = editorCourse.chapters[editorTab] || {
                  title: "",
                  content: "",
                  questions: [],
                  attachedFiles: [],
                };

                return (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                        <span>{"Editing Chapter #" + (editorTab + 1)}</span>
                      </h3>
                      {editorCourse.chapters.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveChapter(editorTab)}
                          className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 px-2.5 py-1 bg-rose-50 rounded-lg"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove Chapter</span>
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                        Chapter Title
                      </label>
                      <input
                        type="text"
                        value={ch.title}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditorCourse((prev) => {
                            const copy = [...prev.chapters];
                            copy[editorTab] = { ...copy[editorTab], title: val };
                            return { ...prev, chapters: copy };
                          });
                        }}
                        placeholder="Chapter Title..."
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50/50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
                      />
                    </div>

                    {/* Quill / MS Word Style Rich Text Toolbar */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                          Chapter Content (HTML / Rich Text)
                        </label>
                      </div>

                      {/* Toolbar */}
                      <div className="flex flex-wrap items-center gap-1 p-2 bg-slate-100/90 border border-slate-200 rounded-t-2xl">
                        {/* Formatting */}
                        <button
                          type="button"
                          onClick={() => execCmd("bold")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.bold
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Bold (Ctrl+B)"
                        >
                          <Bold className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => execCmd("italic")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.italic
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Italic (Ctrl+I)"
                        >
                          <Italic className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => execCmd("underline")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.underline
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Underline (Ctrl+U)"
                        >
                          <Underline className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => execCmd("strikeThrough")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.strike
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Strikethrough"
                        >
                          <Strikethrough className="w-4 h-4" />
                        </button>

                        <div className="w-[1px] h-5 bg-slate-300 mx-1" />

                        {/* Alignments */}
                        <button
                          type="button"
                          onClick={() => execCmd("justifyLeft")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.alignLeft
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Align Left"
                        >
                          <AlignLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => execCmd("justifyCenter")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.alignCenter
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Align Center"
                        >
                          <AlignCenter className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => execCmd("justifyRight")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.alignRight
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Align Right"
                        >
                          <AlignRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => execCmd("justifyFull")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.alignJustify
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Justify"
                        >
                          <AlignJustify className="w-4 h-4" />
                        </button>

                        <div className="w-[1px] h-5 bg-slate-300 mx-1" />

                        {/* Lists */}
                        <button
                          type="button"
                          onClick={() => execCmd("insertUnorderedList")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.unorderedList
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Bullet List"
                        >
                          <List className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => execCmd("insertOrderedList")}
                          className={`p-1.5 rounded transition-all ${
                            toolbarState.orderedList
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-700 hover:bg-white"
                          }`}
                          title="Number List (1, 2, 3)"
                        >
                          <ListOrdered className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => createCustomList("a")}
                          className="px-1.5 py-0.5 text-xs font-bold hover:bg-white rounded text-slate-700"
                          title="Lowercase List (a, b, c)"
                        >
                          a,b
                        </button>
                        <button
                          type="button"
                          onClick={() => createCustomList("A")}
                          className="px-1.5 py-0.5 text-xs font-bold hover:bg-white rounded text-slate-700"
                          title="Uppercase List (A, B, C)"
                        >
                          A,B
                        </button>
                        <button
                          type="button"
                          onClick={() => setListStartModalOpen(true)}
                          className="px-2 py-0.5 text-[11px] font-bold hover:bg-white rounded text-slate-700 border border-slate-300 bg-white shadow-2xs"
                          title="Set List Starting Point"
                        >
                          # Start
                        </button>

                        <div className="w-[1px] h-5 bg-slate-300 mx-1" />

                        {/* Media & Embeds */}
                        <button
                          type="button"
                          onClick={() => openMediaInsert("link")}
                          className="p-1.5 hover:bg-white rounded text-slate-700"
                          title="Insert Link"
                        >
                          <LinkIcon className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openMediaInsert("image")}
                          className="p-1.5 hover:bg-white rounded text-slate-700"
                          title="Insert Image / Upload from PC"
                        >
                          <ImageIcon className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openMediaInsert("video")}
                          className="p-1.5 hover:bg-white rounded text-rose-600"
                          title="Insert YouTube Video"
                        >
                          <Video className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleOpenQnAModal}
                          className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold flex items-center gap-1"
                          title="Insert Q&A from Database"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          <span>Insert Q&A</span>
                        </button>

                        <div className="w-[1px] h-5 bg-slate-300 mx-1" />

                        {/* Font Size Selector */}
                        <select
                          title="Font Size"
                          onChange={(e) => {
                            execCmd("fontSize", e.target.value);
                            e.target.selectedIndex = 0;
                          }}
                          className="px-2 py-1 text-xs bg-white border border-slate-200 rounded text-slate-700 font-semibold outline-none cursor-pointer"
                        >
                          <option value="" disabled selected>
                            Size
                          </option>
                          <option value="1">Small</option>
                          <option value="3">Normal</option>
                          <option value="5">Large</option>
                          <option value="7">Huge</option>
                        </select>

                        {/* Text Color Picker */}
                        <label
                          className="flex items-center gap-1 p-1 hover:bg-white rounded cursor-pointer text-slate-700 text-xs"
                          title="Text Color"
                        >
                          <Palette className="w-4 h-4 text-slate-600" />
                          <input
                            type="color"
                            onChange={(e) => execCmd("foreColor", e.target.value)}
                            className="w-4 h-4 border-none bg-transparent cursor-pointer"
                          />
                        </label>

                        {/* Background Highlight Picker */}
                        <label
                          className="flex items-center gap-1 p-1 hover:bg-white rounded cursor-pointer text-slate-700 text-xs"
                          title="Highlight Color"
                        >
                          <Highlighter className="w-4 h-4 text-slate-600" />
                          <input
                            type="color"
                            defaultValue="#ffff00"
                            onChange={(e) => execCmd("hiliteColor", e.target.value)}
                            className="w-4 h-4 border-none bg-transparent cursor-pointer"
                          />
                        </label>

                        {/* Clear Format */}
                        <button
                          type="button"
                          onClick={() => execCmd("removeFormat")}
                          className="p-1.5 hover:bg-white rounded text-slate-500"
                          title="Clear Formatting"
                        >
                          <Eraser className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Uncontrolled Contenteditable Rich Text Editor Area (Big & Inside Scrollable) */}
                      <div
                        id="richEditorArea"
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        onInput={handleEditorInput}
                        onKeyUp={updateToolbarState}
                        onMouseUp={updateToolbarState}
                        onSelect={updateToolbarState}
                        onClick={handleEditorClick}
                        className="w-full min-h-[500px] max-h-[750px] overflow-y-auto p-6 bg-white border border-t-0 border-slate-200 rounded-b-2xl outline-none focus:ring-2 focus:ring-blue-500/20 leading-relaxed font-sans text-sm text-slate-800 prose prose-slate max-w-none"
                      />
                    </div>

                    {/* Attached Resources Section */}
                    <div className="pt-4 border-t border-slate-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <Paperclip className="w-4 h-4 text-slate-500" />
                          <span>Attached Database Resources ({ch.attachedFiles?.length || 0})</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setAttachModalOpen(true)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Attach Files from Database</span>
                        </button>
                      </div>

                      {ch.attachedFiles && ch.attachedFiles.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {ch.attachedFiles.map((file, fIdx) => (
                            <div
                              key={fIdx}
                              className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <Paperclip className="w-4 h-4 text-blue-600 shrink-0" />
                                <span className="font-semibold text-slate-800 truncate">{file.name}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditorCourse((prev) => {
                                    const copy = [...prev.chapters];
                                    copy[editorTab].attachedFiles = copy[editorTab].attachedFiles?.filter(
                                      (_, i) => i !== fIdx
                                    );
                                    return { ...prev, chapters: copy };
                                  });
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Checkpoint Questions Builder */}
                    <div className="pt-6 border-t border-slate-100 space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <HelpCircle className="w-4 h-4 text-emerald-600" />
                          <span>Chapter Checkpoint Questions ({ch.questions?.length || 0})</span>
                        </h4>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={downloadOnboardQuizTemplate}
                            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Template</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => bulkUploadChapterRef.current?.click()}
                            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            <span>Bulk Upload</span>
                          </button>

                          <input
                            ref={bulkUploadChapterRef}
                            type="file"
                            accept=".xlsx, .xls, .csv"
                            className="hidden"
                            onChange={(e) => handleBulkUpload(e, "chapter")}
                          />

                          <button
                            type="button"
                            onClick={() => {
                              setEditorCourse((prev) => {
                                const copy = [...prev.chapters];
                                const currQs = copy[editorTab].questions || [];
                                copy[editorTab] = {
                                  ...copy[editorTab],
                                  questions: [
                                    ...currQs,
                                    { text: "", options: ["", "", "", ""], correct: 1 },
                                  ],
                                };
                                return { ...prev, chapters: copy };
                              });
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Question</span>
                          </button>
                        </div>
                      </div>

                      {ch.questions?.map((q, qIdx) => (
                        <div key={qIdx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-600">Question #{qIdx + 1}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditorCourse((prev) => {
                                  const copy = [...prev.chapters];
                                  copy[editorTab].questions = copy[editorTab].questions?.filter(
                                    (_, i) => i !== qIdx
                                  );
                                  return { ...prev, chapters: copy };
                                });
                              }}
                              className="text-slate-400 hover:text-rose-600 p-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <input
                            type="text"
                            value={q.text}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditorCourse((prev) => {
                                const copy = [...prev.chapters];
                                const qs = [...(copy[editorTab].questions || [])];
                                qs[qIdx] = { ...qs[qIdx], text: val };
                                copy[editorTab].questions = qs;
                                return { ...prev, chapters: copy };
                              });
                            }}
                            placeholder="Type question text..."
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none font-semibold focus:ring-2 focus:ring-blue-500"
                          />

                          <div className="space-y-1.5">
                            {q.options.map((opt, optIdx) => (
                              <div key={optIdx} className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name={"ch_" + editorTab + "_q_" + qIdx + "_correct"}
                                  checked={Number(q.correct) === optIdx + 1}
                                  onChange={() => {
                                    setEditorCourse((prev) => {
                                      const copy = [...prev.chapters];
                                      const qs = [...(copy[editorTab].questions || [])];
                                      qs[qIdx] = { ...qs[qIdx], correct: optIdx + 1 };
                                      copy[editorTab].questions = qs;
                                      return { ...prev, chapters: copy };
                                    });
                                  }}
                                  className="w-4 h-4 text-emerald-600 cursor-pointer"
                                />
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditorCourse((prev) => {
                                      const copy = [...prev.chapters];
                                      const qs = [...(copy[editorTab].questions || [])];
                                      const opts = [...qs[qIdx].options];
                                      opts[optIdx] = val;
                                      qs[qIdx].options = opts;
                                      copy[editorTab].questions = qs;
                                      return { ...prev, chapters: copy };
                                    });
                                  }}
                                  placeholder={"Option " + String.fromCharCode(65 + optIdx)}
                                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl outline-none"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()
            )}

            {/* 3. FINAL ASSESSMENT TAB */}
            {editorTab === "final" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Final Compulsory Assessment</h3>
                    <p className="text-xs text-slate-500">
                      Evaluated at the end of the curriculum. Score 90%+ required to unlock subsequent phases.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={downloadOnboardQuizTemplate}
                      className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Template</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => bulkUploadFinalRef.current?.click()}
                      className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold flex items-center gap-1"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Bulk Upload</span>
                    </button>

                    <input
                      ref={bulkUploadFinalRef}
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      className="hidden"
                      onChange={(e) => handleBulkUpload(e, "final")}
                    />

                    <button
                      type="button"
                      onClick={() => {
                        setEditorCourse((prev) => ({
                          ...prev,
                          finalQuiz: [
                            ...(prev.finalQuiz || []),
                            { text: "", options: ["", "", "", ""], correct: 1 },
                          ],
                        }));
                      }}
                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Question</span>
                    </button>
                  </div>
                </div>

                {editorCourse.finalQuiz?.map((q, qIdx) => (
                  <div key={qIdx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-600">Question #{qIdx + 1}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditorCourse((prev) => ({
                            ...prev,
                            finalQuiz: prev.finalQuiz?.filter((_, i) => i !== qIdx),
                          }));
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={q.text}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditorCourse((prev) => {
                          const qs = [...(prev.finalQuiz || [])];
                          qs[qIdx] = { ...qs[qIdx], text: val };
                          return { ...prev, finalQuiz: qs };
                        });
                      }}
                      placeholder="Assessment question text..."
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none font-semibold focus:ring-2 focus:ring-purple-500"
                    />

                    <div className="space-y-1.5">
                      {q.options.map((opt, optIdx) => (
                        <div key={optIdx} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={"final_q_" + qIdx + "_correct"}
                            checked={Number(q.correct) === optIdx + 1}
                            onChange={() => {
                              setEditorCourse((prev) => {
                                const qs = [...(prev.finalQuiz || [])];
                                qs[qIdx] = { ...qs[qIdx], correct: optIdx + 1 };
                                return { ...prev, finalQuiz: qs };
                              });
                            }}
                            className="w-4 h-4 text-purple-600 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditorCourse((prev) => {
                                const qs = [...(prev.finalQuiz || [])];
                                const opts = [...qs[qIdx].options];
                                opts[optIdx] = val;
                                qs[qIdx].options = opts;
                                return { ...prev, finalQuiz: qs };
                              });
                            }}
                            placeholder={"Option " + String.fromCharCode(65 + optIdx)}
                            className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 4. REVIEWS & RATINGS TAB */}
            {editorTab === "reviews" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                      <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                      <span>Course Feedback & Ratings</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Ratings and comments submitted by agents who completed this course.
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full font-bold text-xs">
                    {editorCourse.ratings?.length || 0} Total Reviews
                  </span>
                </div>

                {editorCourse.ratings && editorCourse.ratings.length > 0 ? (
                  <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                    {editorCourse.ratings.map((r, i) => (
                      <div key={i} className="py-3.5 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-slate-900">{r.name}</span>
                            <span className="text-slate-400 text-[10px] ml-2">({r.email})</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center text-amber-400">
                              {Array.from({ length: 5 }).map((_, s) => (
                                <Star
                                  key={s}
                                  className={`w-3.5 h-3.5 ${
                                    s < r.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"
                                  }`}
                                />
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteReviewInEditor(r.email)}
                              className="text-slate-400 hover:text-rose-600 p-1"
                              title="Delete Review"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {r.feedback && (
                          <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg leading-relaxed">
                            {r.feedback}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-400 text-xs">
                    No ratings or feedback submitted yet for this course.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ----------------------------------------------------
            VIEW 2: MAIN COURSES DASHBOARD & AGENT ANALYTICS
            ---------------------------------------------------- */
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Manage Courses
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode(viewMode === "analytics" ? "table" : "analytics")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-colors ${
                  viewMode === "analytics"
                    ? "bg-slate-900 text-white"
                    : "bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>{viewMode === "analytics" ? "Back to Courses Table" : "Agent Analytics"}</span>
              </button>

              <button
                onClick={() => handleOpenEditor()}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Course</span>
              </button>
            </div>
          </div>

          {/* 3 Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <GraduationCap className="w-6 h-6 text-blue-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{activeCount}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Active Courses
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <BookOpen className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{totalChapters}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Total Chapters
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <Award className="w-6 h-6 text-purple-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{totalPhases}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Total Training Phases
              </div>
            </div>
          </div>

          {/* TABLE / ANALYTICS TOGGLE */}
          {viewMode === "analytics" ? (
            /* AGENT ANALYTICS TABLE */
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  <span>Agent Curriculum Analytics</span>
                </h3>
                <button
                  onClick={() => setViewMode("table")}
                  className="px-3 py-1 border rounded-lg text-xs font-semibold hover:bg-slate-50"
                >
                  Back to Courses Table
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                      <th className="p-4">Agent Name</th>
                      <th className="p-4 text-center">Completed</th>
                      <th className="p-4 text-center">In Progress</th>
                      <th className="p-4 text-center">Avg Score</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                    {agentAnalytics.map((agent) => (
                      <tr key={agent.email || agent.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{agent.displayName || agent.name || agent.email}</div>
                          <div className="text-[10px] text-slate-400">{agent.email}</div>
                        </td>
                        <td className="p-4 text-center font-bold text-emerald-700">{agent.completed}</td>
                        <td className="p-4 text-center font-bold text-amber-600">{agent.inProgress}</td>
                        <td className="p-4 text-center font-extrabold text-blue-600">{agent.avgScore}%</td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => setSelectedAgent(agent)}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold transition-colors shadow-2xs"
                          >
                            Manage Progress
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* MAIN COURSES TABLE */
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                      <th className="p-4">ID</th>
                      <th className="p-4">Phase</th>
                      <th className="p-4">Course Title</th>
                      <th className="p-4 text-center">Chapters & Qs</th>
                      <th className="p-4 text-center">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-400">
                          Loading courses...
                        </td>
                      </tr>
                    ) : courses.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-400">
                          No courses created yet.
                        </td>
                      </tr>
                    ) : (
                      courses.map((course) => {
                        let totalQuestions = course.finalQuiz?.length || 0;
                        course.chapters?.forEach((ch) => {
                          totalQuestions += ch.questions?.length || 0;
                        });

                        return (
                          <tr key={course.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="p-4 font-mono font-bold text-blue-600">#{course.id}</td>
                            <td className="p-4">
                              <span className="bg-purple-50 text-purple-700 font-bold px-2 py-0.5 rounded text-[10px]">
                                Phase {course.phase || 1}
                              </span>
                            </td>
                            <td className="p-4 font-bold text-slate-900">{course.title}</td>
                            <td className="p-4 text-center">
                              <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg text-xs font-bold">
                                {course.chapters?.length || 0} Ch | {totalQuestions} Qs
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              <button
                                onClick={() => handleToggleActive(course)}
                                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${
                                  course.active
                                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                    : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                }`}
                              >
                                {course.active ? "Active" : "Inactive"}
                              </button>
                            </td>
                            <td className="p-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleOpenEditor(course)}
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded"
                                  title="Edit Course"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteCourse(course.id)}
                                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded"
                                  title="Delete Course"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ====================================================
          MODAL 1: MANAGE AGENT PROGRESS MODAL (LIVE SYNCED & 100% MATCHED)
          ==================================================== */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-2xl w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Manage Course Progress: <span className="text-blue-600">{selectedAgent.displayName || selectedAgent.name || selectedAgent.email}</span>
                </h3>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[11px] font-bold">
                    Completed: {liveSelectedAgentStats.completed}
                  </span>
                  <span className="px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-md text-[11px] font-bold">
                    In Progress: {liveSelectedAgentStats.inProgress}
                  </span>
                  <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-[11px] font-bold">
                    Avg Score: {liveSelectedAgentStats.avgScore}%
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 overflow-y-auto flex-1 pr-1">
              {courses.filter((c) => c.active).length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  No active courses available on the platform.
                </div>
              ) : (
                courses
                  .filter((c) => c.active)
                  .map((c) => {
                    const agentEmail = (selectedAgent.email || selectedAgent.id || "").toLowerCase();
                    // Read live state directly from users snapshot array
                    const liveUser =
                      users.find(
                        (item) => (item.email || item.id || "").toLowerCase() === agentEmail
                      ) || selectedAgent;
                    const rawProg = liveUser?.courseProgress?.[c.id];
                    const prog = rawProg
                      ? recalculateCourseProgress(c, rawProg)
                      : null;

                    const isCompleted = prog?.status === "completed";
                    const isInProgress = prog?.status === "in-progress";

                    return (
                      <div key={c.id} className="py-3.5 flex items-center justify-between text-xs gap-3">
                        <div className="space-y-1">
                          <div className="font-bold text-slate-900 text-sm">{c.title}</div>
                          <div className="flex items-center gap-2">
                            {isCompleted ? (
                              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Completed
                              </span>
                            ) : isInProgress ? (
                              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                In Progress
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-400">
                                Not Started
                              </span>
                            )}

                            <span className="text-slate-400">
                              Final Score:{" "}
                              <strong className="text-slate-700">
                                {prog && prog.finalScore !== null ? prog.finalScore + "%" : "N/A"}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div>
                          {rawProg ? (
                            <button
                              onClick={() => handleResetAgentProgress(agentEmail, c.id)}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-2xs"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Progress</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300 font-medium">— No Data</span>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL 2: RICH TEXT MEDIA INSERT (IMAGE / LINK / VIDEO)
          ==================================================== */}
      {mediaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                {mediaType === "image" && <ImageIcon className="w-5 h-5 text-blue-600" />}
                {mediaType === "link" && <LinkIcon className="w-5 h-5 text-blue-600" />}
                {mediaType === "video" && <Video className="w-5 h-5 text-rose-600" />}
                <span>
                  {mediaType === "image"
                    ? "Insert Image"
                    : mediaType === "link"
                    ? "Insert Link"
                    : "Insert YouTube Video"}
                </span>
              </h3>
              <button
                onClick={() => setMediaModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {mediaType === "link" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Display Text (Optional)
                  </label>
                  <input
                    type="text"
                    value={mediaLinkText}
                    onChange={(e) => setMediaLinkText(e.target.value)}
                    placeholder="e.g. Visit Documentation"
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {mediaType === "image"
                    ? "Image URL or Upload from Computer"
                    : mediaType === "link"
                    ? "Link Target URL (https://...)"
                    : "YouTube Video URL"}
                </label>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mediaUrlInput}
                    onChange={(e) => setMediaUrlInput(e.target.value)}
                    placeholder={
                      mediaType === "image"
                        ? "https://... or upload from PC"
                        : mediaType === "link"
                        ? "https://example.com"
                        : "https://www.youtube.com/watch?v=..."
                    }
                    className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />

                  {mediaType === "image" && (
                    <button
                      type="button"
                      onClick={() => editorImageFileInputRef.current?.click()}
                      disabled={uploadingEditorImage}
                      className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold flex items-center gap-1 shrink-0 transition-colors shadow-2xs"
                      title="Upload Image from PC"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingEditorImage ? "..." : "Upload"}</span>
                    </button>
                  )}
                </div>

                <input
                  ref={editorImageFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleEditorImageUpload}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setMediaModalOpen(false)}
                className="px-4 py-2 border rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMediaInsert}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs"
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL 3: LIST START POINT MODAL
          ==================================================== */}
      {listStartModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-sm w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ListOrdered className="w-5 h-5 text-blue-600" />
                <span>Set List Starting Point</span>
              </h3>
              <button
                onClick={() => setListStartModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Starting Number or Letter (e.g. 3 or C):
              </label>
              <input
                type="text"
                value={listStartValue}
                onChange={(e) => setListStartValue(e.target.value)}
                placeholder="e.g. 3 or C"
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setListStartModalOpen(false)}
                className="px-4 py-2 border rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyListStart}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL 4: Q&A SELECTOR MODAL (INSERT IN BETWEEN LINES)
          ==================================================== */}
      {qnaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-xl w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-blue-600" />
                <span>Insert Q&A into Content</span>
              </h3>
              <button
                onClick={() => setQnaModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative shrink-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={qnaSearch}
                onChange={(e) => setQnaSearch(e.target.value)}
                placeholder="Search Q&A database by code, question, or category..."
                className="w-full pl-9 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="divide-y divide-slate-100 overflow-y-auto flex-1 pr-1">
              {dbQAs
                .filter(
                  (q) =>
                    q.question?.toLowerCase().includes(qnaSearch.toLowerCase()) ||
                    q.qaCode?.toLowerCase().includes(qnaSearch.toLowerCase()) ||
                    q.category?.toLowerCase().includes(qnaSearch.toLowerCase())
                )
                .map((q) => {
                  const isSelected = selectedQnaIds.has(q.id);

                  return (
                    <label
                      key={q.id}
                      className={`py-3 flex items-start gap-3 text-xs cursor-pointer p-2 rounded-xl transition-colors ${
                        isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedQnaIds((prev) => {
                            const copy = new Set(prev);
                            if (copy.has(q.id)) copy.delete(q.id);
                            else copy.add(q.id);
                            return copy;
                          });
                        }}
                        className="mt-1 w-4 h-4 text-blue-600 rounded"
                      />
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-[10px]">
                            {q.qaCode || "QA"}
                          </span>
                          <span className="text-slate-400 text-[10px]">{q.category}</span>
                        </div>
                        <div className="font-bold text-slate-800 text-xs">{q.question}</div>
                        <div className="text-[11px] text-slate-500 line-clamp-2">{q.answer}</div>
                      </div>
                    </label>
                  );
                })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 shrink-0">
              <span className="text-xs text-slate-500 font-semibold">
                {selectedQnaIds.size} Selected
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setQnaModalOpen(false)}
                  className="px-4 py-2 border rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleInsertSelectedQnAs}
                  disabled={selectedQnaIds.size === 0}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs"
                >
                  Insert Selected ({selectedQnaIds.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL 5: ATTACH FILES MODAL
          ==================================================== */}
      {attachModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-lg w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Paperclip className="w-5 h-5 text-blue-600" />
                <span>Attach Files from Database</span>
              </h3>
              <button
                onClick={() => setAttachModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 overflow-y-auto flex-1 pr-1">
              {dbFiles.map((file) => {
                const currentChapter =
                  typeof editorTab === "number" && editorTab >= 0
                    ? editorCourse.chapters[editorTab]
                    : null;
                const isAttached = currentChapter?.attachedFiles?.some((f) => f.id === file.id);

                return (
                  <label
                    key={file.id}
                    className="py-3 flex items-center justify-between text-xs cursor-pointer hover:bg-slate-50 p-2 rounded-xl"
                  >
                    <div className="flex items-center gap-3 truncate">
                      <input
                        type="checkbox"
                        checked={!!isAttached}
                        onChange={() => {
                          if (typeof editorTab !== "number" || editorTab < 0) return;
                          setEditorCourse((prev) => {
                            const copy = [...prev.chapters];
                            const curr = copy[editorTab].attachedFiles || [];
                            if (isAttached) {
                              copy[editorTab] = {
                                ...copy[editorTab],
                                attachedFiles: curr.filter((f) => f.id !== file.id),
                              };
                            } else {
                              copy[editorTab] = {
                                ...copy[editorTab],
                                attachedFiles: [
                                  ...curr,
                                  {
                                    id: file.id,
                                    name: file.name,
                                    url: file.driveUrl || file.dataUrl || file.url || "",
                                    fileType: file.fileType || "",
                                  },
                                ],
                              };
                            }
                            return { ...prev, chapters: copy };
                          });
                        }}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="font-semibold text-slate-800 truncate">{file.name}</span>
                    </div>

                    <span className="text-[10px] text-slate-400">{file.category || "General"}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={() => setAttachModalOpen(false)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
