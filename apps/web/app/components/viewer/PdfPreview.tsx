interface PdfPreviewProps {
  readonly pdfPreviewUrl: string;
  readonly fileName: string;
  readonly isFullscreen: boolean;
}

export function PdfPreview({ pdfPreviewUrl, fileName, isFullscreen }: Readonly<PdfPreviewProps>) {
  return (
    <iframe
      src={pdfPreviewUrl}
      title={fileName}
      className={
        isFullscreen
          ? "w-screen h-screen border-0 bg-white"
          : "w-full h-full min-h-[400px] max-h-[40vh] md:max-h-[90vh] border-0 bg-white"
      }
    />
  );
}
