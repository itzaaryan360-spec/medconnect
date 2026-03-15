import React, { useState } from 'react';

const UploadReport = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [anatomy, setAnatomy] = useState([]);
  const [error, setError] = useState('');

  const handleFile = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setLoading(true);
    setError('');
    setSummary('');
    setAnatomy([]);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/process-report', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.status === 'success') {
        setSummary(data.simplified_summary);
        setAnatomy(data.affected_anatomy || []);
        localStorage.setItem('lastAnatomy', JSON.stringify(data.affected_anatomy || []));
        alert('Report processed! Summary ready.');
      } else {
        setError(data.message || 'Processing failed');
      }
    } catch (err) {
      setError('Cannot connect to backend. Is backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <input
        type="file"
        accept="image/*,.pdf"
        onChange={handleFile}
        className="hidden"
        id="file-upload"
      />
      <label
        htmlFor="file-upload"
        className="cursor-pointer block w-full p-12 border-2 border-dashed border-gray-300 rounded-xl text-center hover:border-blue-500 transition"
      >
        <div className="text-6xl mb-4">📄</div>
        <p className="text-xl font-medium">Drag & drop or click to upload</p>
        <p className="text-sm text-gray-500 mt-2">PDF, JPG, PNG • Max 20MB</p>
      </label>

      <button
        onClick={handleUpload}
        disabled={loading || !file}
        className="w-full py-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition"
      >
        {loading ? 'Analyzing Report...' : 'Analyze Report'}
      </button>

      {error && <p className="text-red-600 text-center font-medium">{error}</p>}

      {summary && (
        <div className="mt-8 p-6 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="text-xl font-semibold mb-4">AI Simplified Summary</h3>
          <p className="text-gray-800 whitespace-pre-wrap">{summary}</p>
        </div>
      )}

      {anatomy.length > 0 && (
        <div className="mt-6 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-xl font-semibold mb-4">Affected Body Parts</h3>
          <p className="text-gray-800">{anatomy.join(', ')}</p>
          <p className="text-sm text-gray-600 mt-2">
            View highlighted areas in 3D View
          </p>
        </div>
      )}
    </div>
  );
};

export default UploadReport;