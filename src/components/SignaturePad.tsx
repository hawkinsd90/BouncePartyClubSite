import { useEffect, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import { RotateCcw } from 'lucide-react';

interface SignaturePadProps {
  onSignatureChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

export default function SignaturePad({ onSignatureChange, disabled = false }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadRef = useRef<SignaturePadLib | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const signaturePad = new SignaturePadLib(canvas, {
      backgroundColor: 'rgb(255, 255, 255)',
      penColor: 'rgb(0, 0, 0)',
      minWidth: 1,
      maxWidth: 3,
    });

    signaturePadRef.current = signaturePad;

    const resizeCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext('2d')?.scale(ratio, ratio);
      signaturePad.clear();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    signaturePad.addEventListener('endStroke', () => {
      const dataUrl = signaturePad.toDataURL('image/png');
      setIsEmpty(false);
      onSignatureChange(dataUrl);
    });

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      signaturePad.off();
    };
  }, [onSignatureChange]);

  useEffect(() => {
    if (signaturePadRef.current && disabled) {
      signaturePadRef.current.off();
    } else if (signaturePadRef.current && !disabled) {
      signaturePadRef.current.on();
    }
  }, [disabled]);

  const handleClear = () => {
    if (signaturePadRef.current) {
      signaturePadRef.current.clear();
      setIsEmpty(true);
      onSignatureChange(null);
    }
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="border-2 border-gray-300 rounded-lg w-full h-48 touch-none"
        style={{ touchAction: 'none' }}
      />
      {!isEmpty && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute top-2 right-2 bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 shadow-sm"
        >
          <RotateCcw className="w-4 h-4" />
          Clear
        </button>
      )}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-gray-400 text-sm">Sign here</p>
        </div>
      )}
    </div>
  );
}
