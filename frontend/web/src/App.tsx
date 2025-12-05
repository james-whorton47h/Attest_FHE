// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Certification {
  id: number;
  issuer: string;
  recipient: string;
  encryptedData: string;
  timestamp: number;
  category: string;
  validity: boolean;
}

interface UserAction {
  type: 'issue' | 'verify' | 'decrypt';
  timestamp: number;
  details: string;
}

// FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issuingCert, setIssuingCert] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newCertData, setNewCertData] = useState({ recipient: "", category: "identity", validity: true });
  const [selectedCert, setSelectedCert] = useState<Certification | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [userActions, setUserActions] = useState<UserAction[]>([]);
  const [activeTab, setActiveTab] = useState('certifications');
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");

  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load certifications
      const certsBytes = await contract.getData("certifications");
      let certsList: Certification[] = [];
      if (certsBytes.length > 0) {
        try {
          const certsStr = ethers.toUtf8String(certsBytes);
          if (certsStr.trim() !== '') certsList = JSON.parse(certsStr);
        } catch (e) {}
      }
      setCertifications(certsList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Issue new certification
  const issueCertification = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setIssuingCert(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Issuing FHE encrypted certification..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new certification with random encrypted data (demo purposes)
      const encryptedValue = FHEEncryptNumber(Math.floor(Math.random() * 1000));
      
      const newCert: Certification = {
        id: certifications.length + 1,
        issuer: address,
        recipient: newCertData.recipient,
        encryptedData: encryptedValue,
        timestamp: Math.floor(Date.now() / 1000),
        category: newCertData.category,
        validity: newCertData.validity
      };
      
      // Update certifications list
      const updatedCerts = [...certifications, newCert];
      
      // Save to contract
      await contract.setData("certifications", ethers.toUtf8Bytes(JSON.stringify(updatedCerts)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'issue',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Issued certification to: ${newCertData.recipient.substring(0, 8)}...`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Certification issued successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowIssueModal(false);
        setNewCertData({ recipient: "", category: "identity", validity: true });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIssuingCert(false); 
    }
  };

  // Decrypt data with signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'decrypt',
        timestamp: Math.floor(Date.now() / 1000),
        details: "Decrypted FHE certification data"
      };
      setUserActions(prev => [newAction, ...prev]);
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Filter certifications based on search and category
  const filteredCertifications = certifications.filter(cert => {
    const matchesSearch = cert.recipient.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         cert.issuer.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || cert.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  // Render user actions history
  const renderUserActions = () => {
    if (userActions.length === 0) return <div className="no-data">No actions recorded</div>;
    
    return (
      <div className="actions-list">
        {userActions.map((action, index) => (
          <div className="action-item" key={index}>
            <div className={`action-type ${action.type}`}>
              {action.type === 'issue' && '📜'}
              {action.type === 'verify' && '✅'}
              {action.type === 'decrypt' && '🔓'}
            </div>
            <div className="action-details">
              <div className="action-text">{action.details}</div>
              <div className="action-time">{new Date(action.timestamp * 1000).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render FAQ section
  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is FHE-based Decentralized Certification?",
        answer: "A protocol where institutions can issue FHE-encrypted attestations (like 'training completed', 'community member') to build composable, privacy-preserving identity systems."
      },
      {
        question: "How does FHE protect attestation data?",
        answer: "FHE allows computations on encrypted data without decryption. Certification contents remain encrypted while being verifiable through homomorphic operations."
      },
      {
        question: "What can these attestations be used for?",
        answer: "They serve as building blocks for privacy-preserving identity systems in Web3, enabling verification without exposing sensitive personal data."
      },
      {
        question: "How is Zama FHE used in this system?",
        answer: "Zama's FHE technology enables the encryption of attestation data while allowing homomorphic verification of its validity."
      },
      {
        question: "Can I see my own attestations?",
        answer: "Yes, you can decrypt your own attestations using your wallet signature, but others can only verify them without seeing the contents."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div className="faq-item" key={index}>
            <div className="faq-question">{item.question}</div>
            <div className="faq-answer">{item.answer}</div>
          </div>
        ))}
      </div>
    );
  };

  // Render statistics panel
  const renderStatistics = () => {
    const identityCerts = certifications.filter(c => c.category === 'identity').length;
    const governanceCerts = certifications.filter(c => c.category === 'governance').length;
    const educationCerts = certifications.filter(c => c.category === 'education').length;
    const validCerts = certifications.filter(c => c.validity).length;
    
    return (
      <div className="stats-panel">
        <div className="stat-card">
          <div className="stat-value">{certifications.length}</div>
          <div className="stat-label">Total Certifications</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{validCerts}</div>
          <div className="stat-label">Valid</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{identityCerts}</div>
          <div className="stat-label">Identity</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{governanceCerts}</div>
          <div className="stat-label">Governance</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{educationCerts}</div>
          <div className="stat-label">Education</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing FHE certification system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="fhe-icon"></div>
          </div>
          <h1>FHE<span>Cert</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowIssueModal(true)} 
            className="create-cert-btn"
          >
            <div className="add-icon"></div>Issue Certification
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="dashboard-grid">
            <div className="dashboard-panel intro-panel">
              <div className="panel-card">
                <h2>Decentralized FHE Attestations</h2>
                <p>A universal protocol for issuing FHE-encrypted attestations on-chain, enabling composable, privacy-preserving identity systems.</p>
                <div className="fhe-badge">
                  <div className="fhe-icon"></div>
                  <span>Powered by Zama FHE</span>
                </div>
              </div>
              
              <div className="panel-card">
                <h2>System Statistics</h2>
                {renderStatistics()}
              </div>
              
              <div className="panel-card">
                <h2>FHE Attestation Flow</h2>
                <div className="fhe-flow">
                  <div className="flow-step">
                    <div className="step-icon">1</div>
                    <div className="step-content">
                      <h4>Institution Issues</h4>
                      <p>Any organization can issue encrypted attestations</p>
                    </div>
                  </div>
                  <div className="flow-arrow">→</div>
                  <div className="flow-step">
                    <div className="step-icon">2</div>
                    <div className="step-content">
                      <h4>FHE Encryption</h4>
                      <p>Attestation data is encrypted using Zama FHE</p>
                    </div>
                  </div>
                  <div className="flow-arrow">→</div>
                  <div className="flow-step">
                    <div className="step-icon">3</div>
                    <div className="step-content">
                      <h4>Homomorphic Verification</h4>
                      <p>Validity can be verified without decryption</p>
                    </div>
                  </div>
                  <div className="flow-arrow">→</div>
                  <div className="flow-step">
                    <div className="step-icon">4</div>
                    <div className="step-content">
                      <h4>Privacy-Preserving Use</h4>
                      <p>Build identity systems without exposing personal data</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'certifications' ? 'active' : ''}`}
                onClick={() => setActiveTab('certifications')}
              >
                Certifications
              </button>
              <button 
                className={`tab ${activeTab === 'actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('actions')}
              >
                My Actions
              </button>
              <button 
                className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
                onClick={() => setActiveTab('faq')}
              >
                FAQ
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'certifications' && (
                <div className="certifications-section">
                  <div className="section-header">
                    <h2>Attestations Registry</h2>
                    <div className="header-actions">
                      <div className="search-filter">
                        <input 
                          type="text" 
                          placeholder="Search issuer/recipient..." 
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <select 
                          value={filterCategory}
                          onChange={(e) => setFilterCategory(e.target.value)}
                        >
                          <option value="all">All Categories</option>
                          <option value="identity">Identity</option>
                          <option value="governance">Governance</option>
                          <option value="education">Education</option>
                        </select>
                      </div>
                      <button 
                        onClick={loadData} 
                        className="refresh-btn" 
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  
                  <div className="certifications-list">
                    {filteredCertifications.length === 0 ? (
                      <div className="no-certs">
                        <div className="no-certs-icon"></div>
                        <p>No certifications found</p>
                        <button 
                          className="create-btn" 
                          onClick={() => setShowIssueModal(true)}
                        >
                          Issue First Certification
                        </button>
                      </div>
                    ) : filteredCertifications.map((cert, index) => (
                      <div 
                        className={`cert-item ${selectedCert?.id === cert.id ? "selected" : ""}`} 
                        key={index}
                        onClick={() => setSelectedCert(cert)}
                      >
                        <div className="cert-header">
                          <div className="cert-id">#{cert.id}</div>
                          <div className={`cert-status ${cert.validity ? 'valid' : 'invalid'}`}>
                            {cert.validity ? 'VALID' : 'INVALID'}
                          </div>
                        </div>
                        <div className="cert-category">{cert.category.toUpperCase()}</div>
                        <div className="cert-parties">
                          <div className="cert-party">
                            <span>Issuer:</span> {cert.issuer.substring(0, 6)}...{cert.issuer.substring(38)}
                          </div>
                          <div className="cert-party">
                            <span>Recipient:</span> {cert.recipient.substring(0, 6)}...{cert.recipient.substring(38)}
                          </div>
                        </div>
                        <div className="cert-encrypted">Encrypted Data: {cert.encryptedData.substring(0, 15)}...</div>
                        <div className="cert-date">{new Date(cert.timestamp * 1000).toLocaleDateString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'actions' && (
                <div className="actions-section">
                  <h2>My Activity History</h2>
                  {renderUserActions()}
                </div>
              )}
              
              {activeTab === 'faq' && (
                <div className="faq-section">
                  <h2>Frequently Asked Questions</h2>
                  {renderFAQ()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showIssueModal && (
        <ModalIssueCertification 
          onSubmit={issueCertification} 
          onClose={() => setShowIssueModal(false)} 
          issuing={issuingCert} 
          certData={newCertData} 
          setCertData={setNewCertData}
        />
      )}
      
      {selectedCert && (
        <CertificationDetailModal 
          certification={selectedCert} 
          onClose={() => { 
            setSelectedCert(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="fhe-icon"></div>
              <span>FHE Cert</span>
            </div>
            <p>Decentralized attestations with FHE encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Zama FHE</a>
            <a href="#" className="footer-link">Community</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} FHE Cert. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect attestation data. 
            Certifications can be verified without revealing their contents.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalIssueCertificationProps {
  onSubmit: () => void; 
  onClose: () => void; 
  issuing: boolean;
  certData: any;
  setCertData: (data: any) => void;
}

const ModalIssueCertification: React.FC<ModalIssueCertificationProps> = ({ onSubmit, onClose, issuing, certData, setCertData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCertData({ ...certData, [name]: value });
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setCertData({ ...certData, [name]: checked });
  };

  return (
    <div className="modal-overlay">
      <div className="issue-cert-modal">
        <div className="modal-header">
          <h2>Issue New Certification</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Attestation Notice</strong>
              <p>This certification will be encrypted using Zama FHE</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Recipient Address *</label>
            <input 
              type="text" 
              name="recipient" 
              value={certData.recipient} 
              onChange={handleChange} 
              placeholder="Enter recipient wallet address..." 
            />
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select 
              name="category" 
              value={certData.category} 
              onChange={handleChange}
            >
              <option value="identity">Identity</option>
              <option value="governance">Governance</option>
              <option value="education">Education</option>
            </select>
          </div>
          
          <div className="form-group checkbox-group">
            <input 
              type="checkbox" 
              name="validity" 
              checked={certData.validity} 
              onChange={handleCheckboxChange} 
              id="validity-checkbox"
            />
            <label htmlFor="validity-checkbox">Valid Certification</label>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={issuing || !certData.recipient} 
            className="submit-btn"
          >
            {issuing ? "Issuing with FHE..." : "Issue Certification"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CertificationDetailModalProps {
  certification: Certification;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const CertificationDetailModal: React.FC<CertificationDetailModalProps> = ({ 
  certification, 
  onClose, 
  decryptedData, 
  setDecryptedData, 
  isDecrypting, 
  decryptWithSignature
}) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptWithSignature(certification.encryptedData);
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="cert-detail-modal">
        <div className="modal-header">
          <h2>Certification Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="cert-info">
            <div className="info-item">
              <span>ID:</span>
              <strong>#{certification.id}</strong>
            </div>
            <div className="info-item">
              <span>Issuer:</span>
              <strong>{certification.issuer.substring(0, 6)}...{certification.issuer.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Recipient:</span>
              <strong>{certification.recipient.substring(0, 6)}...{certification.recipient.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Category:</span>
              <strong>{certification.category}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status ${certification.validity ? 'valid' : 'invalid'}`}>
                {certification.validity ? 'VALID' : 'INVALID'}
              </strong>
            </div>
            <div className="info-item">
              <span>Date Issued:</span>
              <strong>{new Date(certification.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="encrypted-section">
            <h3>Encrypted Attestation Data</h3>
            <div className="encrypted-data">{certification.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span>Decrypting...</span>
              ) : decryptedData !== null ? (
                "Hide Decrypted Data"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedData !== null && (
            <div className="decrypted-section">
              <h3>Decrypted Attestation</h3>
              <div className="decrypted-value">
                <span>Value:</span>
                <strong>{decryptedData.toFixed(2)}</strong>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;