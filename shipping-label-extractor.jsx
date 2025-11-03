import React, { useState, useEffect } from 'react';
import { Upload, Download, FileText, Loader2 } from 'lucide-react';

export default function ShippingLabelExtractor() {
  const [file, setFile] = useState(null);
  const [labels, setLabels] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [pdfLibLoaded, setPdfLibLoaded] = useState(false);

  useEffect(() => {
    // Load PDF.js library
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.onload = () => {
      if (window['pdfjs-dist/build/pdf']) {
        window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc = 
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        setPdfLibLoaded(true);
      }
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setError('');
    setProcessing(true);
    setLabels([]);

    if (!pdfLibLoaded && uploadedFile.type === 'application/pdf') {
      setError('PDF library is still loading. Please wait a moment and try again.');
      setProcessing(false);
      return;
    }

    try {
      if (uploadedFile.type === 'application/pdf') {
        await processPDF(uploadedFile);
      } else if (uploadedFile.type.startsWith('image/')) {
        await processImage(uploadedFile);
      } else {
        setError('Please upload a PDF or image file');
        setProcessing(false);
      }
    } catch (err) {
      setError('Error processing file: ' + err.message);
      setProcessing(false);
    }
  };

  const processPDF = async (file) => {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const extractedLabels = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      
      // Get page dimensions in points (1 point = 1/72 inch)
      const widthInches = viewport.width / 72;
      const heightInches = viewport.height / 72;
      
      console.log(`Page ${i}: ${widthInches.toFixed(2)}" x ${heightInches.toFixed(2)}"`);
      
      // Determine page type
      const is4x6 = (
        (Math.abs(widthInches - 4) < 0.5 && Math.abs(heightInches - 6) < 0.5) ||
        (Math.abs(widthInches - 6) < 0.5 && Math.abs(heightInches - 4) < 0.5)
      );
      
      const is85x11 = (
        (Math.abs(widthInches - 8.5) < 0.5 && Math.abs(heightInches - 11) < 0.5) ||
        (Math.abs(widthInches - 11) < 0.5 && Math.abs(heightInches - 8.5) < 0.5)
      );
      
      if (is4x6) {
        // Already 4x6, just output as-is
        const label = await render4x6Page(page, viewport, i, 1);
        extractedLabels.push(label);
      } else if (is85x11) {
        // 8.5x11 page - need to split into two 4x6 labels
        const labels = await split85x11Page(page, viewport, i);
        extractedLabels.push(...labels);
      } else {
        // Unknown size - try to detect label region
        const label = await detectAndExtractLabel(page, viewport, i);
        if (label) extractedLabels.push(label);
      }
    }

    setLabels(extractedLabels);
    setProcessing(false);
  };

  const detectBorder = (canvas) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    
    // Convert to grayscale and detect edges
    const edges = new Uint8Array(width * height);
    const threshold = 30; // Edge detection threshold
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        
        // Get grayscale values
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        
        // Check neighboring pixels for edges
        const right = ((y * width + x + 1) * 4);
        const down = (((y + 1) * width + x) * 4);
        
        const grayRight = (data[right] + data[right + 1] + data[right + 2]) / 3;
        const grayDown = (data[down] + data[down + 1] + data[down + 2]) / 3;
        
        const diff = Math.max(Math.abs(gray - grayRight), Math.abs(gray - grayDown));
        edges[y * width + x] = diff > threshold ? 255 : 0;
      }
    }
    
    // Find border bounds by scanning from edges inward
    let top = 0, bottom = height - 1, left = 0, right = width - 1;
    const margin = Math.floor(Math.min(width, height) * 0.05); // 5% margin for scan
    const minBorderPixels = Math.floor(Math.min(width, height) * 0.3); // Minimum 30% length to be considered a border
    
    // Scan from top
    for (let y = margin; y < height / 2; y++) {
      let edgeCount = 0;
      for (let x = margin; x < width - margin; x++) {
        if (edges[y * width + x] > 0) edgeCount++;
      }
      if (edgeCount > minBorderPixels) {
        top = y;
        break;
      }
    }
    
    // Scan from bottom
    for (let y = height - margin - 1; y > height / 2; y--) {
      let edgeCount = 0;
      for (let x = margin; x < width - margin; x++) {
        if (edges[y * width + x] > 0) edgeCount++;
      }
      if (edgeCount > minBorderPixels) {
        bottom = y;
        break;
      }
    }
    
    // Scan from left
    for (let x = margin; x < width / 2; x++) {
      let edgeCount = 0;
      for (let y = margin; y < height - margin; y++) {
        if (edges[y * width + x] > 0) edgeCount++;
      }
      if (edgeCount > minBorderPixels) {
        left = x;
        break;
      }
    }
    
    // Scan from right
    for (let x = width - margin - 1; x > width / 2; x--) {
      let edgeCount = 0;
      for (let y = margin; y < height - margin; y++) {
        if (edges[y * width + x] > 0) edgeCount++;
      }
      if (edgeCount > minBorderPixels) {
        right = x;
        break;
      }
    }
    
    // Check if we found a valid border (must be substantial)
    const foundWidth = right - left;
    const foundHeight = bottom - top;
    const minSize = Math.min(width, height) * 0.3; // Border must be at least 30% of canvas size
    
    if (foundWidth > minSize && foundHeight > minSize && 
        foundWidth < width * 0.95 && foundHeight < height * 0.95) {
      return { left, top, right, bottom, detected: true };
    }
    
    return null;
  };

  const split85x11Page = async (page, viewport, pageNum) => {
    const widthInches = viewport.width / 72;
    const heightInches = viewport.height / 72;
    
    // Check if page is portrait (8.5x11) or landscape (11x8.5)
    const isPortrait = heightInches > widthInches;
    
    // Render at high resolution
    const scale = 3;
    const renderViewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = renderViewport.width;
    canvas.height = renderViewport.height;
    
    await page.render({
      canvasContext: context,
      viewport: renderViewport
    }).promise;
    
    const labels = [];
    
    if (isPortrait) {
      // Portrait: Split horizontally into TOP and BOTTOM halves
      // Each half will be landscape (wide), so needs rotation
      const halfHeight = canvas.height / 2;
      
      for (let half = 0; half < 2; half++) {
        const halfSourceY = half * halfHeight;
        
        // Create a temporary canvas for this half
        const halfCanvas = document.createElement('canvas');
        const halfContext = halfCanvas.getContext('2d');
        halfCanvas.width = canvas.width;
        halfCanvas.height = halfHeight;
        
        halfContext.drawImage(
          canvas,
          0, halfSourceY, canvas.width, halfHeight,
          0, 0, canvas.width, halfHeight
        );
        
        // ROTATE: Create a rotated version (90 degrees clockwise)
        const rotatedCanvas = document.createElement('canvas');
        const rotatedContext = rotatedCanvas.getContext('2d');
        rotatedCanvas.width = halfCanvas.height;  // Swap dimensions
        rotatedCanvas.height = halfCanvas.width;
        
        rotatedContext.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
        rotatedContext.rotate(Math.PI / 2);
        rotatedContext.drawImage(halfCanvas, -halfCanvas.width / 2, -halfCanvas.height / 2);
        
        // Detect border on rotated canvas
        const border = detectBorder(rotatedCanvas);
        
        // Create output canvas for 4x6 portrait label
        const outputCanvas = document.createElement('canvas');
        const outputContext = outputCanvas.getContext('2d');
        outputCanvas.width = 1200;  // 4 inches * 300 DPI
        outputCanvas.height = 1800; // 6 inches * 300 DPI
        
        outputContext.fillStyle = 'white';
        outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        
        let sourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight;
        
        if (border) {
          // Use the detected border region
          sourceCanvas = rotatedCanvas;
          sourceX = border.left;
          sourceY = border.top;
          sourceWidth = border.right - border.left;
          sourceHeight = border.bottom - border.top;
        } else {
          // No border detected, use full canvas
          sourceCanvas = rotatedCanvas;
          sourceX = 0;
          sourceY = 0;
          sourceWidth = rotatedCanvas.width;
          sourceHeight = rotatedCanvas.height;
        }
        
        // Scale to fit output canvas
        const scale2 = Math.min(
          outputCanvas.width / sourceWidth,
          outputCanvas.height / sourceHeight
        );
        
        const scaledWidth = sourceWidth * scale2;
        const scaledHeight = sourceHeight * scale2;
        const xOffset = (outputCanvas.width - scaledWidth) / 2;
        const yOffset = (outputCanvas.height - scaledHeight) / 2;
        
        outputContext.drawImage(
          sourceCanvas,
          sourceX, sourceY, sourceWidth, sourceHeight,
          xOffset, yOffset, scaledWidth, scaledHeight
        );
        
        labels.push({
          id: `${pageNum}-${half + 1}`,
          data: outputCanvas.toDataURL('image/png'),
          name: `label_page${pageNum}_${half === 0 ? 'top' : 'bottom'}.png`,
          orientation: 'portrait',
          source: `8.5x11 portrait (${half === 0 ? 'top' : 'bottom'}, rotated${border ? ', border detected' : ''})`
        });
      }
    } else {
      // Landscape: Split vertically into LEFT and RIGHT halves
      // Each half will be portrait (tall), no rotation needed
      const halfWidth = canvas.width / 2;
      
      for (let half = 0; half < 2; half++) {
        const halfSourceX = half * halfWidth;
        
        // Create a temporary canvas for this half
        const halfCanvas = document.createElement('canvas');
        const halfContext = halfCanvas.getContext('2d');
        halfCanvas.width = halfWidth;
        halfCanvas.height = canvas.height;
        
        halfContext.drawImage(
          canvas,
          halfSourceX, 0, halfWidth, canvas.height,
          0, 0, halfWidth, canvas.height
        );
        
        // Detect border on half canvas
        const border = detectBorder(halfCanvas);
        
        // Create output canvas for 4x6 portrait label
        const outputCanvas = document.createElement('canvas');
        const outputContext = outputCanvas.getContext('2d');
        outputCanvas.width = 1200;  // 4 inches * 300 DPI
        outputCanvas.height = 1800; // 6 inches * 300 DPI
        
        outputContext.fillStyle = 'white';
        outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        
        let croppedSourceX, croppedSourceY, croppedSourceWidth, croppedSourceHeight;
        
        if (border) {
          // Use the detected border region
          croppedSourceX = border.left;
          croppedSourceY = border.top;
          croppedSourceWidth = border.right - border.left;
          croppedSourceHeight = border.bottom - border.top;
        } else {
          // No border detected, use full half canvas
          croppedSourceX = 0;
          croppedSourceY = 0;
          croppedSourceWidth = halfCanvas.width;
          croppedSourceHeight = halfCanvas.height;
        }
        
        const scale2 = Math.min(
          outputCanvas.width / croppedSourceWidth,
          outputCanvas.height / croppedSourceHeight
        );
        
        const scaledWidth = croppedSourceWidth * scale2;
        const scaledHeight = croppedSourceHeight * scale2;
        const xOffset = (outputCanvas.width - scaledWidth) / 2;
        const yOffset = (outputCanvas.height - scaledHeight) / 2;
        
        outputContext.drawImage(
          halfCanvas,
          croppedSourceX, croppedSourceY, croppedSourceWidth, croppedSourceHeight,
          xOffset, yOffset, scaledWidth, scaledHeight
        );
        
        labels.push({
          id: `${pageNum}-${half + 1}`,
          data: outputCanvas.toDataURL('image/png'),
          name: `label_page${pageNum}_${half === 0 ? 'left' : 'right'}.png`,
          orientation: 'portrait',
          source: `11x8.5 landscape (${half === 0 ? 'left' : 'right'}${border ? ', border detected' : ''})`
        });
      }
    }
    
    return labels;
  };

  const render4x6Page = async (page, viewport, pageNum, labelNum) => {
    const scale = 3;
    const scaledViewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    
    await page.render({
      canvasContext: context,
      viewport: scaledViewport
    }).promise;
    
    // Detect border on the 4x6 page
    const border = detectBorder(canvas);
    
    // Determine orientation
    const isLandscape = canvas.width > canvas.height;
    
    // Create output canvas
    const outputCanvas = document.createElement('canvas');
    const outputContext = outputCanvas.getContext('2d');
    outputCanvas.width = 1200;  // 4 inches * 300 DPI
    outputCanvas.height = 1800; // 6 inches * 300 DPI
    
    outputContext.fillStyle = 'white';
    outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    
    let sourceX, sourceY, sourceWidth, sourceHeight;
    
    if (border) {
      // Use the detected border region
      sourceX = border.left;
      sourceY = border.top;
      sourceWidth = border.right - border.left;
      sourceHeight = border.bottom - border.top;
    } else {
      // No border detected, use full canvas
      sourceX = 0;
      sourceY = 0;
      sourceWidth = canvas.width;
      sourceHeight = canvas.height;
    }
    
    // Scale to fit
    const scale2 = Math.min(
      outputCanvas.width / sourceWidth,
      outputCanvas.height / sourceHeight
    );
    
    const scaledWidth = sourceWidth * scale2;
    const scaledHeight = sourceHeight * scale2;
    const xOffset = (outputCanvas.width - scaledWidth) / 2;
    const yOffset = (outputCanvas.height - scaledHeight) / 2;
    
    outputContext.drawImage(
      canvas,
      sourceX, sourceY, sourceWidth, sourceHeight,
      xOffset, yOffset, scaledWidth, scaledHeight
    );
    
    return {
      id: `${pageNum}-${labelNum}`,
      data: outputCanvas.toDataURL('image/png'),
      name: `label_page${pageNum}_${labelNum}.png`,
      orientation: 'portrait',
      source: `4x6 page${border ? ' (border detected)' : ''}`
    };
  };

  const detectAndExtractLabel = async (page, viewport, pageNum) => {
    const scale = 3;
    const scaledViewport = page.getViewport({ scale });
    
    const tempCanvas = document.createElement('canvas');
    const tempContext = tempCanvas.getContext('2d');
    tempCanvas.width = scaledViewport.width;
    tempCanvas.height = scaledViewport.height;
    
    await page.render({
      canvasContext: tempContext,
      viewport: scaledViewport
    }).promise;

    // Detect border
    const border = detectBorder(tempCanvas);

    const outputCanvas = document.createElement('canvas');
    const outputContext = outputCanvas.getContext('2d');
    outputCanvas.width = 1200;
    outputCanvas.height = 1800;
    
    outputContext.fillStyle = 'white';
    outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    
    let sourceX, sourceY, sourceWidth, sourceHeight;
    
    if (border) {
      // Use the detected border region
      sourceX = border.left;
      sourceY = border.top;
      sourceWidth = border.right - border.left;
      sourceHeight = border.bottom - border.top;
    } else {
      // No border detected, use full canvas
      sourceX = 0;
      sourceY = 0;
      sourceWidth = tempCanvas.width;
      sourceHeight = tempCanvas.height;
    }
    
    const scale2 = Math.min(
      outputCanvas.width / sourceWidth,
      outputCanvas.height / sourceHeight
    );
    
    const scaledWidth = sourceWidth * scale2;
    const scaledHeight = sourceHeight * scale2;
    const xOffset = (outputCanvas.width - scaledWidth) / 2;
    const yOffset = (outputCanvas.height - scaledHeight) / 2;
    
    outputContext.drawImage(
      tempCanvas,
      sourceX, sourceY, sourceWidth, sourceHeight,
      xOffset, yOffset, scaledWidth, scaledHeight
    );

    return {
      id: `${pageNum}-1`,
      data: outputCanvas.toDataURL('image/png'),
      name: `label_page${pageNum}.png`,
      orientation: 'portrait',
      source: `unknown size page${border ? ' (border detected)' : ''}`
    };
  };

  const processImage = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const img = new Image();
        
        img.onload = () => {
          try {
            // Create canvas with image
            const tempCanvas = document.createElement('canvas');
            const tempContext = tempCanvas.getContext('2d');
            
            // Use high resolution for better detection
            const scale = Math.max(2000 / Math.max(img.width, img.height), 1);
            tempCanvas.width = img.width * scale;
            tempCanvas.height = img.height * scale;
            
            tempContext.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
            
            // Detect border
            const border = detectBorder(tempCanvas);
            
            // Determine orientation based on image aspect ratio
            const isLandscape = img.width > img.height;
            
            // Create the output canvas for 4x6 label
            const outputCanvas = document.createElement('canvas');
            const outputContext = outputCanvas.getContext('2d');
            
            if (isLandscape) {
              outputCanvas.width = 1800;  // 6 inches * 300 DPI
              outputCanvas.height = 1200; // 4 inches * 300 DPI
            } else {
              outputCanvas.width = 1200;  // 4 inches * 300 DPI
              outputCanvas.height = 1800; // 6 inches * 300 DPI
            }
            
            // Fill with white background
            outputContext.fillStyle = 'white';
            outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
            
            let sourceX, sourceY, sourceWidth, sourceHeight;
            
            if (border) {
              // Use the detected border region
              sourceX = border.left;
              sourceY = border.top;
              sourceWidth = border.right - border.left;
              sourceHeight = border.bottom - border.top;
            } else {
              // No border detected, use full canvas
              sourceX = 0;
              sourceY = 0;
              sourceWidth = tempCanvas.width;
              sourceHeight = tempCanvas.height;
            }
            
            // Calculate scaling
            const outputScale = Math.min(
              outputCanvas.width / sourceWidth,
              outputCanvas.height / sourceHeight
            );
            
            const scaledWidth = sourceWidth * outputScale;
            const scaledHeight = sourceHeight * outputScale;
            
            // Center the label
            const xOffset = (outputCanvas.width - scaledWidth) / 2;
            const yOffset = (outputCanvas.height - scaledHeight) / 2;
            
            // Draw the scaled image
            outputContext.drawImage(
              tempCanvas,
              sourceX, sourceY, sourceWidth, sourceHeight,
              xOffset, yOffset, scaledWidth, scaledHeight
            );
            
            const imageData = outputCanvas.toDataURL('image/png');
            setLabels([{
              id: 1,
              data: imageData,
              name: 'shipping_label.png',
              orientation: isLandscape ? 'landscape' : 'portrait',
              source: `image upload${border ? ' (border detected)' : ''}`
            }]);
            setProcessing(false);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const downloadLabel = (label) => {
    const link = document.createElement('a');
    link.href = label.data;
    link.download = label.name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-xl shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center gap-3">
            <FileText className="text-indigo-600" size={36} />
            Shipping Label Extractor
          </h1>
          <p className="text-gray-600 mb-8">
            Upload a PDF file containing shipping labels and extract them as 4x6 downloadable images
          </p>

          {/* Upload Section */}
          <div className="mb-8">
            {!pdfLibLoaded && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-blue-700 text-sm">
                <Loader2 className="animate-spin" size={16} />
                Loading PDF processor...
              </div>
            )}
            <label className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg transition-colors ${
              pdfLibLoaded 
                ? 'border-indigo-300 bg-indigo-50 hover:bg-indigo-100 cursor-pointer' 
                : 'border-gray-300 bg-gray-50 cursor-not-allowed opacity-60'
            }`}>
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className={`w-12 h-12 mb-3 ${pdfLibLoaded ? 'text-indigo-500' : 'text-gray-400'}`} />
                <p className="mb-2 text-sm text-gray-700">
                  <span className="font-semibold">{pdfLibLoaded ? 'Click to upload' : 'Loading...'}</span> {pdfLibLoaded && 'or drag and drop'}
                </p>
                <p className="text-xs text-gray-500">PDF or image files (JPG, PNG, etc.)</p>
              </div>
              <input
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp"
                onChange={handleFileUpload}
                disabled={!pdfLibLoaded}
              />
            </label>
            {file && (
              <p className="mt-2 text-sm text-gray-600">
                Selected: {file.name}
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {/* Processing Indicator */}
          {processing && (
            <div className="flex items-center justify-center gap-3 p-8 bg-indigo-50 rounded-lg">
              <Loader2 className="animate-spin text-indigo-600" size={24} />
              <span className="text-indigo-700 font-medium">Processing labels...</span>
            </div>
          )}

          {/* Labels Display */}
          {labels.length > 0 && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-800">
                  Extracted Labels ({labels.length})
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {labels.map((label) => (
                  <div
                    key={label.id}
                    className="border border-gray-200 rounded-lg p-4 bg-gray-50 hover:shadow-lg transition-shadow"
                  >
                    <div className="bg-white rounded-md overflow-hidden mb-3 border border-gray-200">
                      <img
                        src={label.data}
                        alt={`Label ${label.id}`}
                        className="w-full h-auto"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">
                            Label {label.id}
                          </span>
                          {label.orientation && (
                            <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full">
                              {label.orientation}
                            </span>
                          )}
                        </div>
                        {label.source && (
                          <span className="text-xs text-gray-500">
                            {label.source}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => downloadLabel(label)}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-sm font-medium"
                      >
                        <Download size={16} />
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instructions */}
          {labels.length === 0 && !processing && (
            <div className="mt-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-3">How to use:</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-600 text-sm">
                <li>Upload a PDF file containing shipping labels</li>
                <li><strong>4x6 pages:</strong> Outputs as-is (already correct size)</li>
                <li><strong>8.5x11 portrait:</strong> Splits horizontally into TOP and BOTTOM 4x6 labels</li>
                <li><strong>11x8.5 landscape:</strong> Splits vertically into LEFT and RIGHT 4x6 labels</li>
                <li><strong>Border Detection:</strong> Automatically finds label borders and fits to 4x6</li>
                <li>Download clean, print-ready 4x6 labels as high-quality PNG images</li>
              </ol>
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
                <strong>Smart Border Detection:</strong> The app detects rectangular borders around labels using edge detection, ensuring only the actual label content is extracted!
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
