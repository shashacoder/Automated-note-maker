import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { RecorderControls } from './components/RecorderControls';
import { NoteCard } from './components/NoteCard';
import { ActionToolbar } from './components/ActionToolbar';
import { RefinementModal } from './components/RefinementModal';
import { ConsolidatedView } from './components/ConsolidatedView';
import { ExportModal } from './components/ExportModal';
import { LiveStatusPill } from './components/LiveStatusPill';
import { NoteSegment, RecorderStatus, AudioSource } from './types';
import { processAudioChunk, refineNotes } from './services/geminiService';
import { BrainCircuit } from 'lucide-react';
import { jsPDF } from "jspdf";

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const App: React.FC = () => {
  const [segments, setSegments] = useState<NoteSegment[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastUpdateSeconds, setLastUpdateSeconds] = useState(0); 
  const [audioSource, setAudioSource] = useState<AudioSource>('microphone');
  const [viewMode, setViewMode] = useState<'timeline' | 'consolidated'>('timeline');
  const [structuredNotes, setStructuredNotes] = useState<string | null>(null);
  const [readingMode, setReadingMode] = useState(false); 
  const [isRefinementModalOpen, setIsRefinementModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [refinedContent, setRefinedContent] = useState<string | null>(null);

  const startTimeRef = useRef<number | null>(null);
  const lastContextRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUpdateRef = useRef<number>(Date.now());

  const handleChunkReady = async (blob: Blob) => {
    const newSegmentId = Date.now().toString();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    setSegments(prev => [...prev, {
      id: newSegmentId,
      timestamp,
      transcript: "",
      notes: [],
      status: 'processing',
      confidence: 0
    }]);

    try {
      const base64Audio = await blobToBase64(blob);
      const result = await processAudioChunk(base64Audio, blob.type, lastContextRef.current);
      if (result.transcript) lastContextRef.current = result.transcript.slice(-300);
      
      setSegments(prev => prev.map(seg => seg.id === newSegmentId ? {
        ...seg,
        transcript: result.transcript,
        notes: result.notes,
        status: 'completed',
        confidence: result.notes.length > 0 ? 0.95 : 0.6
      } : seg));
      lastUpdateRef.current = Date.now();
    } catch (error) {
      setSegments(prev => prev.map(seg => seg.id === newSegmentId ? { ...seg, status: 'error', transcript: "Error processing audio." } : seg));
    }
  };

  const { status, startRecording, stopRecording, pauseRecording, resumeRecording } = useAudioRecorder({
    onChunkReady: handleChunkReady,
    chunkDurationMs: 30000 
  });

  // Timer logic
  useEffect(() => {
    let interval: number;
    if (status === RecorderStatus.RECORDING) {
      startTimeRef.current = Date.now() - (elapsedSeconds * 1000);
      interval = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - (startTimeRef.current || Date.now())) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status]); // Remove elapsedSeconds from deps to prevent re-instantiating every second

  useEffect(() => {
    const savedSegments = localStorage.getItem('lectureflow_segments');
    if (savedSegments) {
      try { setSegments(JSON.parse(savedSegments)); } catch (e) { console.error("Restore failed", e); }
    }
    const savedStructure = localStorage.getItem('lectureflow_structure');
    if (savedStructure) setStructuredNotes(savedStructure);
  }, []);

  useEffect(() => {
    localStorage.setItem('lectureflow_segments', JSON.stringify(segments));
  }, [segments]);
  
  useEffect(() => {
    if (structuredNotes) localStorage.setItem('lectureflow_structure', structuredNotes);
    else localStorage.removeItem('lectureflow_structure');
  }, [structuredNotes]);

  useEffect(() => {
    const interval = setInterval(() => {
        setLastUpdateSeconds(Math.floor((Date.now() - lastUpdateRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleClearSession = useCallback(() => {
    const confirmClear = window.confirm("Are you sure you want to delete all notes? This cannot be undone.");
    if (confirmClear) {
      setSegments([]);
      setStructuredNotes(null);
      setRefinedContent(null);
      lastContextRef.current = "";
      localStorage.removeItem('lectureflow_segments');
      localStorage.removeItem('lectureflow_structure');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setElapsedSeconds(0);
    }
  }, []);

  const handleRefine = async (purpose: string) => {
    setIsRefining(true);
    try {
      const sourceNotes = structuredNotes || segments.flatMap(s => s.notes).join("\n- ");
      const transcriptContext = segments.map(s => s.transcript).join("\n");
      const result = await refineNotes(sourceNotes, transcriptContext, purpose);
      setRefinedContent(result);
    } catch (e) {
      alert("Refinement failed.");
    } finally {
      setIsRefining(false);
    }
  };

  const handleExport = (content: string, type: 'pdf' | 'word', filename: string) => {
    if (type === 'pdf') {
        const doc = new jsPDF();
        let y = 20;
        const margin = 20;
        const width = 170;
        const lines = content.split('\n');
        lines.forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed) { y += 5; return; }
          if (trimmed.startsWith('## ')) {
            doc.setFontSize(16); doc.setFont('helvetica', 'bold');
            const wrapped = doc.splitTextToSize(trimmed.replace('## ', ''), width);
            doc.text(wrapped, margin, y); y += (wrapped.length * 7) + 3;
          } else if (trimmed.startsWith('### ')) {
            doc.setFontSize(13); doc.setFont('helvetica', 'bold');
            const wrapped = doc.splitTextToSize(trimmed.replace('### ', ''), width);
            doc.text(wrapped, margin, y); y += (wrapped.length * 6) + 2;
          } else if (/^[\*\-\s]+/.test(trimmed)) {
            doc.setFontSize(11); doc.setFont('helvetica', 'normal');
            const cleanText = '• ' + trimmed.replace(/^[\*\-\s]+/, '').replace(/\*\*/g, '');
            const wrapped = doc.splitTextToSize(cleanText, width - 10);
            doc.text(wrapped, margin + 5, y); y += (wrapped.length * 5) + 1.5;
          } else {
            doc.setFontSize(11); doc.setFont('helvetica', 'normal');
            const wrapped = doc.splitTextToSize(trimmed.replace(/\*\*/g, ''), width);
            doc.text(wrapped, margin, y); y += (wrapped.length * 5) + 1.5;
          }
          if (y > 275) { doc.addPage(); y = 20; }
        });
        doc.save(`${filename}.pdf`);
    } else {
        let html = `<html><head><meta charset='utf-8'><style>body{font-family:Calibri,sans-serif;line-height:1.6;color:#333}h2{color:#2563eb;border-bottom:1px solid #ddd;padding-bottom:5px;margin-top:25px}h3{color:#1e293b;margin-top:20px}ul{margin-bottom:15px}li{margin-bottom:5px}p{margin-bottom:10px}</style></head><body>`;
        content.split('\n').forEach(line => {
          const t = line.trim();
          if (!t) return;
          const p = t.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
          if (t.startsWith('## ')) html += `<h2>${p.replace('## ', '')}</h2>`;
          else if (t.startsWith('### ')) html += `<h3>${p.replace('### ', '')}</h3>`;
          else if (/^[\*\-\s]/.test(t)) html += `<ul><li>${p.replace(/^[\*\-\s]+/, '')}</li></ul>`;
          else html += `<p>${p}</p>`;
        });
        html += `</body></html>`;
        const blob = new Blob([html], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filename}.doc`;
        link.click();
    }
  };

  const performExport = (format: 'pdf' | 'word', scope: 'notes-only' | 'with-transcript') => {
    let content = structuredNotes || segments.flatMap(s => s.notes).map(n => `* ${n}`).join('\n');
    if (scope === 'with-transcript') {
        content += `\n\n## Full Transcript\n\n` + segments.map(s => s.transcript).join('\n\n');
    }
    handleExport(content, format, 'lecture-flow-notes');
    setIsExportModalOpen(false);
  };

  const hasData = segments.length > 0 || !!structuredNotes;

  return (
    <div className="min-h-screen flex flex-col items-center py-6 px-3 md:py-10 md:px-8 bg-[#0B1120] text-slate-200 selection:bg-blue-500/30">
      <LiveStatusPill status={status} segmentCount={segments.length} secondsSinceLastUpdate={lastUpdateSeconds} />

      {!readingMode && (
         <RecorderControls 
           status={status} 
           audioSource={audioSource} 
           setAudioSource={setAudioSource} 
           onStart={() => startRecording(audioSource)} 
           onStop={stopRecording} 
           timerString={`${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`} 
         />
      )}

      <div ref={scrollRef} className="w-full max-w-3xl flex-1 flex flex-col overflow-y-auto max-h-[calc(100vh-150px)] scrollbar-hide pb-32">
        {segments.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center text-slate-500 mt-20 opacity-60">
            <BrainCircuit size={64} className="mb-6" />
            <h3 className="text-xl font-medium mb-1">LectureFlow is ready</h3>
            <p className="text-sm">Start recording to capture live notes automatically.</p>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {viewMode === 'timeline' ? (
              <div className="ml-2">{segments.map(s => <NoteCard key={s.id} segment={s} />)}</div>
            ) : (
              <ConsolidatedView segments={segments} structuredNotes={structuredNotes} setStructuredNotes={setStructuredNotes} />
            )}
          </div>
        )}
      </div>

      <ActionToolbar 
        hasNotes={hasData} status={status} 
        onStop={stopRecording} onPause={pauseRecording} onResume={resumeRecording}
        onRefineClick={() => setIsRefinementModalOpen(true)} onExportClick={() => setIsExportModalOpen(true)} 
        onClear={handleClearSession} viewMode={viewMode} setViewMode={setViewMode} 
        readingMode={readingMode} setReadingMode={setReadingMode} 
      />

      <RefinementModal 
        isOpen={isRefinementModalOpen} onClose={() => setIsRefinementModalOpen(false)} 
        onRefine={handleRefine} isRefining={isRefining} refinedContent={refinedContent} 
        setRefinedContent={setRefinedContent} onExport={(c, t) => handleExport(c, t, 'refined-notes')}
        fullTranscript={segments.map(s => s.transcript).join('\n')}
      />

      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} onExport={performExport} />
    </div>
  );
};

export default App;