-- Common ICD-10-CM codes for primary care
-- Source: CMS ICD-10-CM code set (public domain)
-- Covers ~600 frequently used billable codes across major categories

INSERT INTO icd10_codes (code, description, category, category_description, is_billable)
VALUES
  -- =========================================================================
  -- DIABETES (E08-E13)
  -- =========================================================================
  ('E11', 'Type 2 diabetes mellitus', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.0', 'Type 2 diabetes mellitus with hyperosmolarity', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.00', 'Type 2 diabetes mellitus with hyperosmolarity without nonketotic hyperglycemic-hyperosmolar coma', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.01', 'Type 2 diabetes mellitus with hyperosmolarity with coma', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.1', 'Type 2 diabetes mellitus with ketoacidosis', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.10', 'Type 2 diabetes mellitus with ketoacidosis without coma', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.11', 'Type 2 diabetes mellitus with ketoacidosis with coma', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.2', 'Type 2 diabetes mellitus with kidney complications', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.21', 'Type 2 diabetes mellitus with diabetic nephropathy', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.22', 'Type 2 diabetes mellitus with diabetic chronic kidney disease', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.29', 'Type 2 diabetes mellitus with other diabetic kidney complication', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.3', 'Type 2 diabetes mellitus with ophthalmic complications', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.31', 'Type 2 diabetes mellitus with unspecified diabetic retinopathy', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.311', 'Type 2 diabetes mellitus with unspecified diabetic retinopathy with macular edema', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.319', 'Type 2 diabetes mellitus with unspecified diabetic retinopathy without macular edema', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.36', 'Type 2 diabetes mellitus with diabetic cataract', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.4', 'Type 2 diabetes mellitus with neurological complications', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.40', 'Type 2 diabetes mellitus with diabetic neuropathy, unspecified', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.41', 'Type 2 diabetes mellitus with diabetic mononeuropathy', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.42', 'Type 2 diabetes mellitus with diabetic polyneuropathy', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.43', 'Type 2 diabetes mellitus with diabetic autonomic (poly)neuropathy', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.5', 'Type 2 diabetes mellitus with circulatory complications', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.51', 'Type 2 diabetes mellitus with diabetic peripheral angiopathy without gangrene', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.52', 'Type 2 diabetes mellitus with diabetic peripheral angiopathy with gangrene', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.59', 'Type 2 diabetes mellitus with other circulatory complications', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.6', 'Type 2 diabetes mellitus with other specified complications', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.61', 'Type 2 diabetes mellitus with diabetic arthropathy', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.610', 'Type 2 diabetes mellitus with diabetic neuropathic arthropathy', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.618', 'Type 2 diabetes mellitus with other diabetic arthropathy', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.62', 'Type 2 diabetes mellitus with skin complications', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.620', 'Type 2 diabetes mellitus with diabetic dermatitis', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.621', 'Type 2 diabetes mellitus with foot ulcer', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.622', 'Type 2 diabetes mellitus with other skin ulcer', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.628', 'Type 2 diabetes mellitus with other skin complications', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.630', 'Type 2 diabetes mellitus with periodontal disease', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.638', 'Type 2 diabetes mellitus with other oral complications', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.64', 'Type 2 diabetes mellitus with hypoglycemia', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.641', 'Type 2 diabetes mellitus with hypoglycemia with coma', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.649', 'Type 2 diabetes mellitus with hypoglycemia without coma', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.65', 'Type 2 diabetes mellitus with hyperglycemia', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.69', 'Type 2 diabetes mellitus with other specified complication', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.8', 'Type 2 diabetes mellitus with unspecified complications', 'E11', 'Type 2 diabetes mellitus', true),
  ('E11.9', 'Type 2 diabetes mellitus without complications', 'E11', 'Type 2 diabetes mellitus', true),
  ('E10.9', 'Type 1 diabetes mellitus without complications', 'E10', 'Type 1 diabetes mellitus', true),
  ('E10.65', 'Type 1 diabetes mellitus with hyperglycemia', 'E10', 'Type 1 diabetes mellitus', true),
  ('E10.10', 'Type 1 diabetes mellitus with ketoacidosis without coma', 'E10', 'Type 1 diabetes mellitus', true),
  ('E10.40', 'Type 1 diabetes mellitus with diabetic neuropathy, unspecified', 'E10', 'Type 1 diabetes mellitus', true),
  ('E10.42', 'Type 1 diabetes mellitus with diabetic polyneuropathy', 'E10', 'Type 1 diabetes mellitus', true),
  ('E10.649', 'Type 1 diabetes mellitus with hypoglycemia without coma', 'E10', 'Type 1 diabetes mellitus', true),
  ('E13.9', 'Other specified diabetes mellitus without complications', 'E13', 'Other specified diabetes mellitus', true),

  -- =========================================================================
  -- HYPERTENSION (I10-I16)
  -- =========================================================================
  ('I10', 'Essential (primary) hypertension', 'I10', 'Essential (primary) hypertension', true),
  ('I11', 'Hypertensive heart disease', 'I11', 'Hypertensive heart disease', false),
  ('I11.0', 'Hypertensive heart disease with heart failure', 'I11', 'Hypertensive heart disease', true),
  ('I11.9', 'Hypertensive heart disease without heart failure', 'I11', 'Hypertensive heart disease', true),
  ('I12', 'Hypertensive chronic kidney disease', 'I12', 'Hypertensive chronic kidney disease', false),
  ('I12.0', 'Hypertensive chronic kidney disease with stage 5 CKD or ESRD', 'I12', 'Hypertensive chronic kidney disease', true),
  ('I12.9', 'Hypertensive chronic kidney disease with stage 1-4 CKD or unspecified CKD', 'I12', 'Hypertensive chronic kidney disease', true),
  ('I13.0', 'Hypertensive heart and chronic kidney disease with heart failure and stage 1-4 CKD', 'I13', 'Hypertensive heart and chronic kidney disease', true),
  ('I13.10', 'Hypertensive heart and chronic kidney disease without heart failure, with stage 1-4 CKD', 'I13', 'Hypertensive heart and chronic kidney disease', true),
  ('I16.0', 'Hypertensive urgency', 'I16', 'Hypertensive crisis', true),
  ('I16.1', 'Hypertensive emergency', 'I16', 'Hypertensive crisis', true),

  -- =========================================================================
  -- HYPERLIPIDEMIA (E78)
  -- =========================================================================
  ('E78', 'Disorders of lipoprotein metabolism', 'E78', 'Disorders of lipoprotein metabolism', false),
  ('E78.0', 'Pure hypercholesterolemia, unspecified', 'E78', 'Disorders of lipoprotein metabolism', false),
  ('E78.00', 'Pure hypercholesterolemia, unspecified', 'E78', 'Disorders of lipoprotein metabolism', true),
  ('E78.01', 'Familial hypercholesterolemia', 'E78', 'Disorders of lipoprotein metabolism', true),
  ('E78.1', 'Pure hyperglyceridemia', 'E78', 'Disorders of lipoprotein metabolism', true),
  ('E78.2', 'Mixed hyperlipidemia', 'E78', 'Disorders of lipoprotein metabolism', true),
  ('E78.4', 'Other hyperlipidemia', 'E78', 'Disorders of lipoprotein metabolism', false),
  ('E78.41', 'Elevated lipoprotein(a)', 'E78', 'Disorders of lipoprotein metabolism', true),
  ('E78.49', 'Other hyperlipidemia', 'E78', 'Disorders of lipoprotein metabolism', true),
  ('E78.5', 'Hyperlipidemia, unspecified', 'E78', 'Disorders of lipoprotein metabolism', true),

  -- =========================================================================
  -- OBESITY (E66)
  -- =========================================================================
  ('E66', 'Overweight and obesity', 'E66', 'Overweight and obesity', false),
  ('E66.0', 'Obesity due to excess calories', 'E66', 'Overweight and obesity', false),
  ('E66.01', 'Morbid (severe) obesity due to excess calories', 'E66', 'Overweight and obesity', true),
  ('E66.09', 'Other obesity due to excess calories', 'E66', 'Overweight and obesity', true),
  ('E66.1', 'Drug-induced obesity', 'E66', 'Overweight and obesity', true),
  ('E66.2', 'Morbid (severe) obesity with alveolar hypoventilation', 'E66', 'Overweight and obesity', true),
  ('E66.3', 'Overweight', 'E66', 'Overweight and obesity', true),
  ('E66.8', 'Other obesity', 'E66', 'Overweight and obesity', true),
  ('E66.9', 'Obesity, unspecified', 'E66', 'Overweight and obesity', true),

  -- =========================================================================
  -- HYPOTHYROIDISM (E03)
  -- =========================================================================
  ('E03', 'Other hypothyroidism', 'E03', 'Other hypothyroidism', false),
  ('E03.0', 'Congenital hypothyroidism with diffuse goiter', 'E03', 'Other hypothyroidism', true),
  ('E03.1', 'Congenital hypothyroidism without goiter', 'E03', 'Other hypothyroidism', true),
  ('E03.2', 'Hypothyroidism due to medicaments and other exogenous substances', 'E03', 'Other hypothyroidism', true),
  ('E03.3', 'Postinfectious hypothyroidism', 'E03', 'Other hypothyroidism', true),
  ('E03.4', 'Atrophy of thyroid (acquired)', 'E03', 'Other hypothyroidism', true),
  ('E03.5', 'Myxedema coma', 'E03', 'Other hypothyroidism', true),
  ('E03.8', 'Other specified hypothyroidism', 'E03', 'Other hypothyroidism', true),
  ('E03.9', 'Hypothyroidism, unspecified', 'E03', 'Other hypothyroidism', true),
  ('E05.90', 'Thyrotoxicosis, unspecified without thyrotoxic crisis or storm', 'E05', 'Thyrotoxicosis', true),
  ('E06.3', 'Autoimmune thyroiditis', 'E06', 'Thyroiditis', true),

  -- =========================================================================
  -- ANXIETY AND DEPRESSION (F30-F48)
  -- =========================================================================
  ('F32', 'Major depressive disorder, single episode', 'F32', 'Major depressive disorder, single episode', false),
  ('F32.0', 'Major depressive disorder, single episode, mild', 'F32', 'Major depressive disorder, single episode', true),
  ('F32.1', 'Major depressive disorder, single episode, moderate', 'F32', 'Major depressive disorder, single episode', true),
  ('F32.2', 'Major depressive disorder, single episode, severe without psychotic features', 'F32', 'Major depressive disorder, single episode', true),
  ('F32.3', 'Major depressive disorder, single episode, severe with psychotic features', 'F32', 'Major depressive disorder, single episode', true),
  ('F32.4', 'Major depressive disorder, single episode, in partial remission', 'F32', 'Major depressive disorder, single episode', true),
  ('F32.5', 'Major depressive disorder, single episode, in full remission', 'F32', 'Major depressive disorder, single episode', true),
  ('F32.89', 'Other specified depressive episodes', 'F32', 'Major depressive disorder, single episode', true),
  ('F32.9', 'Major depressive disorder, single episode, unspecified', 'F32', 'Major depressive disorder, single episode', true),
  ('F32.A', 'Depression, unspecified', 'F32', 'Major depressive disorder, single episode', true),
  ('F33.0', 'Major depressive disorder, recurrent, mild', 'F33', 'Major depressive disorder, recurrent', true),
  ('F33.1', 'Major depressive disorder, recurrent, moderate', 'F33', 'Major depressive disorder, recurrent', true),
  ('F33.2', 'Major depressive disorder, recurrent severe without psychotic features', 'F33', 'Major depressive disorder, recurrent', true),
  ('F33.9', 'Major depressive disorder, recurrent, unspecified', 'F33', 'Major depressive disorder, recurrent', true),
  ('F41', 'Other anxiety disorders', 'F41', 'Other anxiety disorders', false),
  ('F41.0', 'Panic disorder without agoraphobia', 'F41', 'Other anxiety disorders', true),
  ('F41.1', 'Generalized anxiety disorder', 'F41', 'Other anxiety disorders', true),
  ('F41.3', 'Other mixed anxiety disorders', 'F41', 'Other anxiety disorders', true),
  ('F41.8', 'Other specified anxiety disorders', 'F41', 'Other anxiety disorders', true),
  ('F41.9', 'Anxiety disorder, unspecified', 'F41', 'Other anxiety disorders', true),
  ('F43.10', 'Post-traumatic stress disorder, unspecified', 'F43', 'Reaction to severe stress', true),
  ('F43.11', 'Post-traumatic stress disorder, acute', 'F43', 'Reaction to severe stress', true),
  ('F43.12', 'Post-traumatic stress disorder, chronic', 'F43', 'Reaction to severe stress', true),
  ('F43.20', 'Adjustment disorder, unspecified', 'F43', 'Reaction to severe stress', true),
  ('F43.21', 'Adjustment disorder with depressed mood', 'F43', 'Reaction to severe stress', true),
  ('F43.22', 'Adjustment disorder with anxiety', 'F43', 'Reaction to severe stress', true),
  ('F43.23', 'Adjustment disorder with mixed anxiety and depressed mood', 'F43', 'Reaction to severe stress', true),
  ('F90.0', 'Attention-deficit hyperactivity disorder, predominantly inattentive type', 'F90', 'Attention-deficit hyperactivity disorders', true),
  ('F90.1', 'Attention-deficit hyperactivity disorder, predominantly hyperactive type', 'F90', 'Attention-deficit hyperactivity disorders', true),
  ('F90.2', 'Attention-deficit hyperactivity disorder, combined type', 'F90', 'Attention-deficit hyperactivity disorders', true),
  ('F90.9', 'Attention-deficit hyperactivity disorder, unspecified type', 'F90', 'Attention-deficit hyperactivity disorders', true),
  ('F31.9', 'Bipolar disorder, unspecified', 'F31', 'Bipolar disorder', true),
  ('F51.01', 'Primary insomnia', 'F51', 'Sleep disorders', true),
  ('F51.02', 'Adjustment insomnia', 'F51', 'Sleep disorders', true),

  -- =========================================================================
  -- RESPIRATORY INFECTIONS (J00-J22)
  -- =========================================================================
  ('J00', 'Acute nasopharyngitis (common cold)', 'J00', 'Acute nasopharyngitis', true),
  ('J01.90', 'Acute sinusitis, unspecified', 'J01', 'Acute sinusitis', true),
  ('J02.0', 'Streptococcal pharyngitis', 'J02', 'Acute pharyngitis', true),
  ('J02.9', 'Acute pharyngitis, unspecified', 'J02', 'Acute pharyngitis', true),
  ('J03.90', 'Acute tonsillitis, unspecified', 'J03', 'Acute tonsillitis', true),
  ('J06.9', 'Acute upper respiratory infection, unspecified', 'J06', 'Acute upper respiratory infections of multiple and unspecified sites', true),
  ('J09.X1', 'Influenza due to identified novel influenza A virus with pneumonia', 'J09', 'Influenza due to certain identified influenza viruses', true),
  ('J10.1', 'Influenza due to other identified influenza virus with other respiratory manifestations', 'J10', 'Influenza due to other identified influenza virus', true),
  ('J11.1', 'Influenza due to unidentified influenza virus with other respiratory manifestations', 'J11', 'Influenza due to unidentified influenza virus', true),
  ('J12.89', 'Other viral pneumonia', 'J12', 'Viral pneumonia, not elsewhere classified', true),
  ('J12.82', 'Pneumonia due to SARS-associated coronavirus', 'J12', 'Viral pneumonia, not elsewhere classified', true),
  ('J18.1', 'Lobar pneumonia, unspecified organism', 'J18', 'Pneumonia, unspecified organism', true),
  ('J18.9', 'Pneumonia, unspecified organism', 'J18', 'Pneumonia, unspecified organism', true),
  ('J20.9', 'Acute bronchitis, unspecified', 'J20', 'Acute bronchitis', true),
  ('J21.9', 'Acute bronchiolitis, unspecified', 'J21', 'Acute bronchiolitis', true),

  -- =========================================================================
  -- ASTHMA (J45)
  -- =========================================================================
  ('J45', 'Asthma', 'J45', 'Asthma', false),
  ('J45.2', 'Mild intermittent asthma', 'J45', 'Asthma', false),
  ('J45.20', 'Mild intermittent asthma, uncomplicated', 'J45', 'Asthma', true),
  ('J45.21', 'Mild intermittent asthma with (acute) exacerbation', 'J45', 'Asthma', true),
  ('J45.22', 'Mild intermittent asthma with status asthmaticus', 'J45', 'Asthma', true),
  ('J45.3', 'Mild persistent asthma', 'J45', 'Asthma', false),
  ('J45.30', 'Mild persistent asthma, uncomplicated', 'J45', 'Asthma', true),
  ('J45.31', 'Mild persistent asthma with (acute) exacerbation', 'J45', 'Asthma', true),
  ('J45.32', 'Mild persistent asthma with status asthmaticus', 'J45', 'Asthma', true),
  ('J45.4', 'Moderate persistent asthma', 'J45', 'Asthma', false),
  ('J45.40', 'Moderate persistent asthma, uncomplicated', 'J45', 'Asthma', true),
  ('J45.41', 'Moderate persistent asthma with (acute) exacerbation', 'J45', 'Asthma', true),
  ('J45.42', 'Moderate persistent asthma with status asthmaticus', 'J45', 'Asthma', true),
  ('J45.5', 'Severe persistent asthma', 'J45', 'Asthma', false),
  ('J45.50', 'Severe persistent asthma, uncomplicated', 'J45', 'Asthma', true),
  ('J45.51', 'Severe persistent asthma with (acute) exacerbation', 'J45', 'Asthma', true),
  ('J45.52', 'Severe persistent asthma with status asthmaticus', 'J45', 'Asthma', true),
  ('J45.90', 'Unspecified asthma, uncomplicated', 'J45', 'Asthma', true),
  ('J45.901', 'Unspecified asthma with (acute) exacerbation', 'J45', 'Asthma', true),
  ('J45.902', 'Unspecified asthma with status asthmaticus', 'J45', 'Asthma', true),
  ('J45.909', 'Unspecified asthma, uncomplicated', 'J45', 'Asthma', true),
  ('J45.990', 'Exercise induced bronchospasm', 'J45', 'Asthma', true),
  ('J45.991', 'Cough variant asthma', 'J45', 'Asthma', true),

  -- =========================================================================
  -- COPD (J44)
  -- =========================================================================
  ('J44', 'Other chronic obstructive pulmonary disease', 'J44', 'Other chronic obstructive pulmonary disease', false),
  ('J44.0', 'COPD with (acute) lower respiratory infection', 'J44', 'Other chronic obstructive pulmonary disease', true),
  ('J44.1', 'COPD with (acute) exacerbation', 'J44', 'Other chronic obstructive pulmonary disease', true),
  ('J44.9', 'COPD, unspecified', 'J44', 'Other chronic obstructive pulmonary disease', true),

  -- =========================================================================
  -- HEART FAILURE (I50)
  -- =========================================================================
  ('I50', 'Heart failure', 'I50', 'Heart failure', false),
  ('I50.1', 'Left ventricular failure, unspecified', 'I50', 'Heart failure', true),
  ('I50.2', 'Systolic (congestive) heart failure', 'I50', 'Heart failure', false),
  ('I50.20', 'Unspecified systolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.21', 'Acute systolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.22', 'Chronic systolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.23', 'Acute on chronic systolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.3', 'Diastolic (congestive) heart failure', 'I50', 'Heart failure', false),
  ('I50.30', 'Unspecified diastolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.31', 'Acute diastolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.32', 'Chronic diastolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.33', 'Acute on chronic diastolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.4', 'Combined systolic and diastolic (congestive) heart failure', 'I50', 'Heart failure', false),
  ('I50.40', 'Unspecified combined systolic and diastolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.41', 'Acute combined systolic and diastolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.42', 'Chronic combined systolic and diastolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.43', 'Acute on chronic combined systolic and diastolic (congestive) heart failure', 'I50', 'Heart failure', true),
  ('I50.9', 'Heart failure, unspecified', 'I50', 'Heart failure', true),
  ('I50.810', 'Right heart failure, unspecified', 'I50', 'Heart failure', true),
  ('I50.811', 'Acute right heart failure', 'I50', 'Heart failure', true),
  ('I50.812', 'Chronic right heart failure', 'I50', 'Heart failure', true),
  ('I50.813', 'Acute on chronic right heart failure', 'I50', 'Heart failure', true),
  ('I50.814', 'Right heart failure due to left heart failure', 'I50', 'Heart failure', true),
  ('I50.82', 'Biventricular heart failure', 'I50', 'Heart failure', true),
  ('I50.83', 'High output heart failure', 'I50', 'Heart failure', true),
  ('I50.84', 'End stage heart failure', 'I50', 'Heart failure', true),
  ('I50.89', 'Other heart failure', 'I50', 'Heart failure', true),

  -- =========================================================================
  -- CORONARY ARTERY DISEASE (I25)
  -- =========================================================================
  ('I25', 'Chronic ischemic heart disease', 'I25', 'Chronic ischemic heart disease', false),
  ('I25.1', 'Atherosclerotic heart disease of native coronary artery', 'I25', 'Chronic ischemic heart disease', false),
  ('I25.10', 'Atherosclerotic heart disease of native coronary artery without angina pectoris', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.110', 'Atherosclerotic heart disease of native coronary artery with unstable angina pectoris', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.111', 'Atherosclerotic heart disease of native coronary artery with angina pectoris with documented spasm', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.118', 'Atherosclerotic heart disease of native coronary artery with other forms of angina pectoris', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.119', 'Atherosclerotic heart disease of native coronary artery with unspecified angina pectoris', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.2', 'Old myocardial infarction', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.5', 'Ischemic cardiomyopathy', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.6', 'Silent myocardial ischemia', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.700', 'Atherosclerosis of coronary artery bypass graft(s) with unstable angina pectoris', 'I25', 'Chronic ischemic heart disease', true),
  ('I25.9', 'Chronic ischemic heart disease, unspecified', 'I25', 'Chronic ischemic heart disease', true),

  -- =========================================================================
  -- ATRIAL FIBRILLATION (I48)
  -- =========================================================================
  ('I48', 'Atrial fibrillation and flutter', 'I48', 'Atrial fibrillation and flutter', false),
  ('I48.0', 'Paroxysmal atrial fibrillation', 'I48', 'Atrial fibrillation and flutter', true),
  ('I48.1', 'Persistent atrial fibrillation', 'I48', 'Atrial fibrillation and flutter', false),
  ('I48.11', 'Long standing persistent atrial fibrillation', 'I48', 'Atrial fibrillation and flutter', true),
  ('I48.19', 'Other persistent atrial fibrillation', 'I48', 'Atrial fibrillation and flutter', true),
  ('I48.2', 'Chronic atrial fibrillation', 'I48', 'Atrial fibrillation and flutter', false),
  ('I48.20', 'Chronic atrial fibrillation, unspecified', 'I48', 'Atrial fibrillation and flutter', true),
  ('I48.21', 'Permanent atrial fibrillation', 'I48', 'Atrial fibrillation and flutter', true),
  ('I48.3', 'Typical atrial flutter', 'I48', 'Atrial fibrillation and flutter', true),
  ('I48.4', 'Atypical atrial flutter', 'I48', 'Atrial fibrillation and flutter', true),
  ('I48.91', 'Unspecified atrial fibrillation', 'I48', 'Atrial fibrillation and flutter', true),
  ('I48.92', 'Unspecified atrial flutter', 'I48', 'Atrial fibrillation and flutter', true),

  -- =========================================================================
  -- CHRONIC KIDNEY DISEASE (N18)
  -- =========================================================================
  ('N18', 'Chronic kidney disease', 'N18', 'Chronic kidney disease', false),
  ('N18.1', 'Chronic kidney disease, stage 1', 'N18', 'Chronic kidney disease', true),
  ('N18.2', 'Chronic kidney disease, stage 2 (mild)', 'N18', 'Chronic kidney disease', true),
  ('N18.3', 'Chronic kidney disease, stage 3 (moderate)', 'N18', 'Chronic kidney disease', false),
  ('N18.30', 'Chronic kidney disease, stage 3 unspecified', 'N18', 'Chronic kidney disease', true),
  ('N18.31', 'Chronic kidney disease, stage 3a', 'N18', 'Chronic kidney disease', true),
  ('N18.32', 'Chronic kidney disease, stage 3b', 'N18', 'Chronic kidney disease', true),
  ('N18.4', 'Chronic kidney disease, stage 4 (severe)', 'N18', 'Chronic kidney disease', true),
  ('N18.5', 'Chronic kidney disease, stage 5', 'N18', 'Chronic kidney disease', true),
  ('N18.6', 'End stage renal disease', 'N18', 'Chronic kidney disease', true),
  ('N18.9', 'Chronic kidney disease, unspecified', 'N18', 'Chronic kidney disease', true),

  -- =========================================================================
  -- GERD (K21)
  -- =========================================================================
  ('K21', 'Gastro-esophageal reflux disease', 'K21', 'Gastro-esophageal reflux disease', false),
  ('K21.0', 'Gastro-esophageal reflux disease with esophagitis', 'K21', 'Gastro-esophageal reflux disease', false),
  ('K21.00', 'Gastro-esophageal reflux disease with esophagitis, without bleeding', 'K21', 'Gastro-esophageal reflux disease', true),
  ('K21.01', 'Gastro-esophageal reflux disease with esophagitis, with bleeding', 'K21', 'Gastro-esophageal reflux disease', true),
  ('K21.9', 'Gastro-esophageal reflux disease without esophagitis', 'K21', 'Gastro-esophageal reflux disease', false),
  ('K21.90', 'Gastro-esophageal reflux disease without esophagitis without bleeding', 'K21', 'Gastro-esophageal reflux disease', true),

  -- =========================================================================
  -- BACK PAIN (M54)
  -- =========================================================================
  ('M54', 'Dorsalgia', 'M54', 'Dorsalgia', false),
  ('M54.2', 'Cervicalgia', 'M54', 'Dorsalgia', true),
  ('M54.4', 'Lumbago with sciatica', 'M54', 'Dorsalgia', false),
  ('M54.40', 'Lumbago with sciatica, unspecified side', 'M54', 'Dorsalgia', true),
  ('M54.41', 'Lumbago with sciatica, right side', 'M54', 'Dorsalgia', true),
  ('M54.42', 'Lumbago with sciatica, left side', 'M54', 'Dorsalgia', true),
  ('M54.5', 'Low back pain', 'M54', 'Dorsalgia', true),
  ('M54.50', 'Low back pain, unspecified', 'M54', 'Dorsalgia', true),
  ('M54.51', 'Vertebrogenic low back pain', 'M54', 'Dorsalgia', true),
  ('M54.59', 'Other low back pain', 'M54', 'Dorsalgia', true),
  ('M54.6', 'Pain in thoracic spine', 'M54', 'Dorsalgia', true),
  ('M54.89', 'Other dorsalgia', 'M54', 'Dorsalgia', true),
  ('M54.9', 'Dorsalgia, unspecified', 'M54', 'Dorsalgia', true),

  -- =========================================================================
  -- OSTEOARTHRITIS (M15-M19)
  -- =========================================================================
  ('M15.0', 'Primary generalized (osteo)arthritis', 'M15', 'Polyosteoarthritis', true),
  ('M15.9', 'Polyosteoarthritis, unspecified', 'M15', 'Polyosteoarthritis', true),
  ('M16.0', 'Bilateral primary osteoarthritis of hip', 'M16', 'Osteoarthritis of hip', true),
  ('M16.10', 'Unilateral primary osteoarthritis, unspecified hip', 'M16', 'Osteoarthritis of hip', true),
  ('M16.11', 'Unilateral primary osteoarthritis, right hip', 'M16', 'Osteoarthritis of hip', true),
  ('M16.12', 'Unilateral primary osteoarthritis, left hip', 'M16', 'Osteoarthritis of hip', true),
  ('M16.9', 'Osteoarthritis of hip, unspecified', 'M16', 'Osteoarthritis of hip', true),
  ('M17.0', 'Bilateral primary osteoarthritis of knee', 'M17', 'Osteoarthritis of knee', true),
  ('M17.10', 'Unilateral primary osteoarthritis, unspecified knee', 'M17', 'Osteoarthritis of knee', true),
  ('M17.11', 'Unilateral primary osteoarthritis, right knee', 'M17', 'Osteoarthritis of knee', true),
  ('M17.12', 'Unilateral primary osteoarthritis, left knee', 'M17', 'Osteoarthritis of knee', true),
  ('M17.9', 'Osteoarthritis of knee, unspecified', 'M17', 'Osteoarthritis of knee', true),
  ('M19.011', 'Primary osteoarthritis, right shoulder', 'M19', 'Other and unspecified osteoarthritis', true),
  ('M19.012', 'Primary osteoarthritis, left shoulder', 'M19', 'Other and unspecified osteoarthritis', true),
  ('M19.041', 'Primary osteoarthritis, right hand', 'M19', 'Other and unspecified osteoarthritis', true),
  ('M19.042', 'Primary osteoarthritis, left hand', 'M19', 'Other and unspecified osteoarthritis', true),
  ('M19.071', 'Primary osteoarthritis, right ankle and foot', 'M19', 'Other and unspecified osteoarthritis', true),
  ('M19.072', 'Primary osteoarthritis, left ankle and foot', 'M19', 'Other and unspecified osteoarthritis', true),
  ('M19.90', 'Unspecified osteoarthritis, unspecified site', 'M19', 'Other and unspecified osteoarthritis', true),

  -- =========================================================================
  -- ALLERGIC RHINITIS (J30)
  -- =========================================================================
  ('J30', 'Vasomotor and allergic rhinitis', 'J30', 'Vasomotor and allergic rhinitis', false),
  ('J30.0', 'Vasomotor rhinitis', 'J30', 'Vasomotor and allergic rhinitis', true),
  ('J30.1', 'Allergic rhinitis due to pollen', 'J30', 'Vasomotor and allergic rhinitis', true),
  ('J30.2', 'Other seasonal allergic rhinitis', 'J30', 'Vasomotor and allergic rhinitis', true),
  ('J30.5', 'Allergic rhinitis due to food', 'J30', 'Vasomotor and allergic rhinitis', true),
  ('J30.81', 'Allergic rhinitis due to animal (cat) (dog) hair and dander', 'J30', 'Vasomotor and allergic rhinitis', true),
  ('J30.89', 'Other allergic rhinitis', 'J30', 'Vasomotor and allergic rhinitis', true),
  ('J30.9', 'Allergic rhinitis, unspecified', 'J30', 'Vasomotor and allergic rhinitis', true),

  -- =========================================================================
  -- UTI (N39)
  -- =========================================================================
  ('N39.0', 'Urinary tract infection, site not specified', 'N39', 'Other disorders of urinary system', true),
  ('N30.00', 'Acute cystitis without hematuria', 'N30', 'Cystitis', true),
  ('N30.01', 'Acute cystitis with hematuria', 'N30', 'Cystitis', true),
  ('N30.10', 'Interstitial cystitis (chronic) without hematuria', 'N30', 'Cystitis', true),
  ('N30.90', 'Cystitis, unspecified without hematuria', 'N30', 'Cystitis', true),

  -- =========================================================================
  -- HEADACHE AND MIGRAINE (G43, R51)
  -- =========================================================================
  ('G43', 'Migraine', 'G43', 'Migraine', false),
  ('G43.0', 'Migraine without aura', 'G43', 'Migraine', false),
  ('G43.00', 'Migraine without aura, not intractable', 'G43', 'Migraine', false),
  ('G43.001', 'Migraine without aura, not intractable, with status migrainosus', 'G43', 'Migraine', true),
  ('G43.009', 'Migraine without aura, not intractable, without status migrainosus', 'G43', 'Migraine', true),
  ('G43.01', 'Migraine without aura, intractable', 'G43', 'Migraine', false),
  ('G43.019', 'Migraine without aura, intractable, without status migrainosus', 'G43', 'Migraine', true),
  ('G43.1', 'Migraine with aura', 'G43', 'Migraine', false),
  ('G43.10', 'Migraine with aura, not intractable', 'G43', 'Migraine', false),
  ('G43.109', 'Migraine with aura, not intractable, without status migrainosus', 'G43', 'Migraine', true),
  ('G43.11', 'Migraine with aura, intractable', 'G43', 'Migraine', false),
  ('G43.119', 'Migraine with aura, intractable, without status migrainosus', 'G43', 'Migraine', true),
  ('G43.70', 'Chronic migraine without aura, not intractable', 'G43', 'Migraine', false),
  ('G43.709', 'Chronic migraine without aura, not intractable, without status migrainosus', 'G43', 'Migraine', true),
  ('G43.71', 'Chronic migraine without aura, intractable', 'G43', 'Migraine', false),
  ('G43.719', 'Chronic migraine without aura, intractable, without status migrainosus', 'G43', 'Migraine', true),
  ('G43.90', 'Migraine, unspecified, not intractable', 'G43', 'Migraine', false),
  ('G43.909', 'Migraine, unspecified, not intractable, without status migrainosus', 'G43', 'Migraine', true),
  ('G43.911', 'Migraine, unspecified, intractable, with status migrainosus', 'G43', 'Migraine', true),
  ('G43.919', 'Migraine, unspecified, intractable, without status migrainosus', 'G43', 'Migraine', true),
  ('G44.1', 'Vascular headache, not elsewhere classified', 'G44', 'Other headache syndromes', true),
  ('G44.209', 'Tension-type headache, unspecified, not intractable', 'G44', 'Other headache syndromes', true),
  ('G44.219', 'Episodic tension-type headache, intractable', 'G44', 'Other headache syndromes', true),
  ('G44.229', 'Chronic tension-type headache, not intractable', 'G44', 'Other headache syndromes', true),
  ('R51.0', 'Headache with orthostatic component, not elsewhere classified', 'R51', 'Headache', true),
  ('R51.9', 'Headache, unspecified', 'R51', 'Headache', true),

  -- =========================================================================
  -- SKIN CONDITIONS (L20, L40, L50, L70)
  -- =========================================================================
  ('L20', 'Atopic dermatitis', 'L20', 'Atopic dermatitis', false),
  ('L20.0', 'Besnier prurigo', 'L20', 'Atopic dermatitis', true),
  ('L20.81', 'Atopic neurodermatitis', 'L20', 'Atopic dermatitis', true),
  ('L20.82', 'Flexural eczema', 'L20', 'Atopic dermatitis', true),
  ('L20.84', 'Intrinsic (allergic) eczema', 'L20', 'Atopic dermatitis', true),
  ('L20.89', 'Other atopic dermatitis', 'L20', 'Atopic dermatitis', true),
  ('L20.9', 'Atopic dermatitis, unspecified', 'L20', 'Atopic dermatitis', true),
  ('L30.9', 'Dermatitis, unspecified', 'L30', 'Other and unspecified dermatitis', true),
  ('L40', 'Psoriasis', 'L40', 'Psoriasis', false),
  ('L40.0', 'Psoriasis vulgaris', 'L40', 'Psoriasis', true),
  ('L40.1', 'Generalized pustular psoriasis', 'L40', 'Psoriasis', true),
  ('L40.4', 'Guttate psoriasis', 'L40', 'Psoriasis', true),
  ('L40.50', 'Arthropathic psoriasis, unspecified', 'L40', 'Psoriasis', true),
  ('L40.8', 'Other psoriasis', 'L40', 'Psoriasis', true),
  ('L40.9', 'Psoriasis, unspecified', 'L40', 'Psoriasis', true),
  ('L50.0', 'Allergic urticaria', 'L50', 'Urticaria', true),
  ('L50.1', 'Idiopathic urticaria', 'L50', 'Urticaria', true),
  ('L50.9', 'Urticaria, unspecified', 'L50', 'Urticaria', true),
  ('L70.0', 'Acne vulgaris', 'L70', 'Acne', true),
  ('L70.1', 'Acne conglobata', 'L70', 'Acne', true),
  ('L70.9', 'Acne, unspecified', 'L70', 'Acne', true),

  -- =========================================================================
  -- GI CONDITIONS (K50, K51, K58)
  -- =========================================================================
  ('K50.90', 'Crohn disease, unspecified, without complications', 'K50', 'Crohn disease', true),
  ('K51.90', 'Ulcerative colitis, unspecified, without complications', 'K51', 'Ulcerative colitis', true),
  ('K58.0', 'Irritable bowel syndrome with diarrhea', 'K58', 'Irritable bowel syndrome', true),
  ('K58.1', 'Irritable bowel syndrome with constipation', 'K58', 'Irritable bowel syndrome', true),
  ('K58.2', 'Mixed irritable bowel syndrome', 'K58', 'Irritable bowel syndrome', true),
  ('K58.8', 'Other irritable bowel syndrome', 'K58', 'Irritable bowel syndrome', true),
  ('K58.9', 'Irritable bowel syndrome without diarrhea', 'K58', 'Irritable bowel syndrome', true),
  ('K57.30', 'Diverticulosis of large intestine without perforation or abscess without bleeding', 'K57', 'Diverticular disease of intestine', true),
  ('K59.00', 'Constipation, unspecified', 'K59', 'Other functional intestinal disorders', true),
  ('K59.04', 'Chronic idiopathic constipation', 'K59', 'Other functional intestinal disorders', true),
  ('K76.0', 'Fatty (change of) liver, not elsewhere classified', 'K76', 'Other diseases of liver', true),
  ('K92.1', 'Melena', 'K92', 'Other diseases of digestive system', true),

  -- =========================================================================
  -- ANEMIA (D50, D64)
  -- =========================================================================
  ('D50.0', 'Iron deficiency anemia secondary to blood loss (chronic)', 'D50', 'Iron deficiency anemia', true),
  ('D50.1', 'Sideropenic dysphagia', 'D50', 'Iron deficiency anemia', true),
  ('D50.8', 'Other iron deficiency anemias', 'D50', 'Iron deficiency anemia', true),
  ('D50.9', 'Iron deficiency anemia, unspecified', 'D50', 'Iron deficiency anemia', true),
  ('D64.9', 'Anemia, unspecified', 'D64', 'Other anemias', true),

  -- =========================================================================
  -- VITAMIN D DEFICIENCY (E55)
  -- =========================================================================
  ('E55.9', 'Vitamin D deficiency, unspecified', 'E55', 'Vitamin D deficiency', true),

  -- =========================================================================
  -- OTHER CARDIOVASCULAR (I20, I21, I63, I73)
  -- =========================================================================
  ('I20.0', 'Unstable angina', 'I20', 'Angina pectoris', true),
  ('I20.9', 'Angina pectoris, unspecified', 'I20', 'Angina pectoris', true),
  ('I21.3', 'ST elevation (STEMI) myocardial infarction of unspecified site', 'I21', 'Acute myocardial infarction', true),
  ('I21.9', 'Acute myocardial infarction, unspecified', 'I21', 'Acute myocardial infarction', true),
  ('I63.9', 'Cerebral infarction, unspecified', 'I63', 'Cerebral infarction', true),
  ('I73.9', 'Peripheral vascular disease, unspecified', 'I73', 'Other peripheral vascular diseases', true),
  ('I87.2', 'Venous insufficiency (chronic) (peripheral)', 'I87', 'Other disorders of veins', true),

  -- =========================================================================
  -- SLEEP DISORDERS (G47)
  -- =========================================================================
  ('G47.00', 'Insomnia, unspecified', 'G47', 'Sleep disorders', true),
  ('G47.09', 'Other insomnia', 'G47', 'Sleep disorders', true),
  ('G47.30', 'Sleep apnea, unspecified', 'G47', 'Sleep disorders', true),
  ('G47.33', 'Obstructive sleep apnea (adult) (pediatric)', 'G47', 'Sleep disorders', true),

  -- =========================================================================
  -- MISCELLANEOUS COMMON CONDITIONS
  -- =========================================================================
  ('R05.9', 'Cough, unspecified', 'R05', 'Cough', true),
  ('R05.1', 'Acute cough', 'R05', 'Cough', true),
  ('R05.3', 'Chronic cough', 'R05', 'Cough', true),
  ('R06.00', 'Dyspnea, unspecified', 'R06', 'Abnormalities of breathing', true),
  ('R06.02', 'Shortness of breath', 'R06', 'Abnormalities of breathing', true),
  ('R07.9', 'Chest pain, unspecified', 'R07', 'Pain in throat and chest', true),
  ('R10.9', 'Unspecified abdominal pain', 'R10', 'Abdominal and pelvic pain', true),
  ('R10.10', 'Upper abdominal pain, unspecified', 'R10', 'Abdominal and pelvic pain', true),
  ('R10.30', 'Lower abdominal pain, unspecified', 'R10', 'Abdominal and pelvic pain', true),
  ('R10.84', 'Generalized abdominal pain', 'R10', 'Abdominal and pelvic pain', true),
  ('R11.0', 'Nausea', 'R11', 'Nausea and vomiting', true),
  ('R11.10', 'Vomiting, unspecified', 'R11', 'Nausea and vomiting', true),
  ('R11.2', 'Nausea with vomiting, unspecified', 'R11', 'Nausea and vomiting', true),
  ('R19.7', 'Diarrhea, unspecified', 'R19', 'Other symptoms involving the digestive system and abdomen', true),
  ('R42', 'Dizziness and giddiness', 'R42', 'Dizziness and giddiness', true),
  ('R50.9', 'Fever, unspecified', 'R50', 'Fever of other and unknown origin', true),
  ('R53.1', 'Weakness', 'R53', 'Malaise and fatigue', true),
  ('R53.81', 'Other malaise', 'R53', 'Malaise and fatigue', true),
  ('R53.82', 'Chronic fatigue, unspecified', 'R53', 'Malaise and fatigue', true),
  ('R53.83', 'Other fatigue', 'R53', 'Malaise and fatigue', true),
  ('R55', 'Syncope and collapse', 'R55', 'Syncope and collapse', true),
  ('R56.9', 'Unspecified convulsions', 'R56', 'Convulsions, not elsewhere classified', true),
  ('R63.4', 'Abnormal weight loss', 'R63', 'Symptoms and signs concerning food and fluid intake', true),
  ('R63.5', 'Abnormal weight gain', 'R63', 'Symptoms and signs concerning food and fluid intake', true),
  ('R73.03', 'Prediabetes', 'R73', 'Elevated blood glucose level', true),
  ('R73.09', 'Other abnormal glucose', 'R73', 'Elevated blood glucose level', true),

  -- =========================================================================
  -- MUSCULOSKELETAL (M25, M79)
  -- =========================================================================
  ('M25.50', 'Pain in unspecified joint', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M25.511', 'Pain in right shoulder', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M25.512', 'Pain in left shoulder', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M25.551', 'Pain in right hip', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M25.552', 'Pain in left hip', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M25.561', 'Pain in right knee', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M25.562', 'Pain in left knee', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M25.571', 'Pain in right ankle and joints of right foot', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M25.572', 'Pain in left ankle and joints of left foot', 'M25', 'Other joint disorder, not elsewhere classified', true),
  ('M79.1', 'Myalgia', 'M79', 'Other and unspecified soft tissue disorders', false),
  ('M79.10', 'Myalgia, unspecified site', 'M79', 'Other and unspecified soft tissue disorders', true),
  ('M79.3', 'Panniculitis, unspecified', 'M79', 'Other and unspecified soft tissue disorders', true),
  ('M79.7', 'Fibromyalgia', 'M79', 'Other and unspecified soft tissue disorders', true),
  ('M62.830', 'Muscle spasm of back', 'M62', 'Other disorders of muscle', true),
  ('M62.838', 'Other muscle spasm', 'M62', 'Other disorders of muscle', true),

  -- =========================================================================
  -- GOUT (M10)
  -- =========================================================================
  ('M10.00', 'Idiopathic gout, unspecified site', 'M10', 'Gout', true),
  ('M10.011', 'Idiopathic gout, right shoulder', 'M10', 'Gout', true),
  ('M10.061', 'Idiopathic gout, right knee', 'M10', 'Gout', true),
  ('M10.062', 'Idiopathic gout, left knee', 'M10', 'Gout', true),
  ('M10.071', 'Idiopathic gout, right ankle and foot', 'M10', 'Gout', true),
  ('M10.072', 'Idiopathic gout, left ankle and foot', 'M10', 'Gout', true),
  ('M10.9', 'Gout, unspecified', 'M10', 'Gout', true),

  -- =========================================================================
  -- OSTEOPOROSIS (M80, M81)
  -- =========================================================================
  ('M80.00XA', 'Age-related osteoporosis with current pathological fracture, unspecified site, initial encounter', 'M80', 'Osteoporosis with current pathological fracture', true),
  ('M81.0', 'Age-related osteoporosis without current pathological fracture', 'M81', 'Osteoporosis without current pathological fracture', true),
  ('M81.8', 'Other osteoporosis without current pathological fracture', 'M81', 'Osteoporosis without current pathological fracture', true),

  -- =========================================================================
  -- EAR/EYE CONDITIONS
  -- =========================================================================
  ('H66.90', 'Otitis media, unspecified, unspecified ear', 'H66', 'Suppurative and unspecified otitis media', true),
  ('H66.91', 'Otitis media, unspecified, right ear', 'H66', 'Suppurative and unspecified otitis media', true),
  ('H66.92', 'Otitis media, unspecified, left ear', 'H66', 'Suppurative and unspecified otitis media', true),
  ('H10.10', 'Acute atopic conjunctivitis, unspecified eye', 'H10', 'Conjunctivitis', true),
  ('H10.30', 'Unspecified acute conjunctivitis, unspecified eye', 'H10', 'Conjunctivitis', true),
  ('H10.9', 'Unspecified conjunctivitis', 'H10', 'Conjunctivitis', true),

  -- =========================================================================
  -- EPILEPSY (G40)
  -- =========================================================================
  ('G20', 'Parkinson disease', 'G20', 'Parkinson disease', true),
  ('G40.909', 'Epilepsy, unspecified, not intractable, without status epilepticus', 'G40', 'Epilepsy and recurrent seizures', true),
  ('G40.919', 'Epilepsy, unspecified, intractable, without status epilepticus', 'G40', 'Epilepsy and recurrent seizures', true),

  -- =========================================================================
  -- NEOPLASMS AND SCREENING
  -- =========================================================================
  ('C18.9', 'Malignant neoplasm of colon, unspecified', 'C18', 'Malignant neoplasm of colon', true),
  ('C34.90', 'Malignant neoplasm of unspecified part of unspecified bronchus or lung', 'C34', 'Malignant neoplasm of bronchus and lung', true),
  ('C50.919', 'Malignant neoplasm of unspecified site of unspecified female breast', 'C50', 'Malignant neoplasm of breast', true),
  ('C61', 'Malignant neoplasm of prostate', 'C61', 'Malignant neoplasm of prostate', true),
  ('D17.9', 'Benign lipomatous neoplasm, unspecified', 'D17', 'Benign lipomatous neoplasm', true),
  ('D22.9', 'Melanocytic nevi, unspecified', 'D22', 'Melanocytic nevi', true),
  ('Z12.11', 'Encounter for screening for malignant neoplasm of colon', 'Z12', 'Encounter for screening for malignant neoplasms', true),
  ('Z12.31', 'Encounter for screening mammogram for malignant neoplasm of breast', 'Z12', 'Encounter for screening for malignant neoplasms', true),
  ('Z12.4', 'Encounter for screening for malignant neoplasm of cervix', 'Z12', 'Encounter for screening for malignant neoplasms', true),

  -- =========================================================================
  -- PREVENTIVE CARE / WELLNESS
  -- =========================================================================
  ('Z00.00', 'Encounter for general adult medical examination without abnormal findings', 'Z00', 'Encounter for general examination without complaint', true),
  ('Z00.01', 'Encounter for general adult medical examination with abnormal findings', 'Z00', 'Encounter for general examination without complaint', true),
  ('Z23', 'Encounter for immunization', 'Z23', 'Encounter for immunization', true),
  ('Z71.3', 'Dietary counseling and surveillance', 'Z71', 'Persons encountering health services for other counseling', true),

  -- =========================================================================
  -- INFECTIOUS DISEASES (B15-B19)
  -- =========================================================================
  ('B18.2', 'Chronic viral hepatitis C', 'B18', 'Chronic viral hepatitis', true),

  -- =========================================================================
  -- SUBSTANCE USE
  -- =========================================================================
  ('F17.210', 'Nicotine dependence, cigarettes, uncomplicated', 'F17', 'Nicotine dependence', true),
  ('F17.211', 'Nicotine dependence, cigarettes, in remission', 'F17', 'Nicotine dependence', true),
  ('Z87.891', 'Personal history of nicotine dependence', 'Z87', 'Personal history of other diseases and conditions', true),
  ('F10.10', 'Alcohol abuse, uncomplicated', 'F10', 'Alcohol related disorders', true),
  ('F10.20', 'Alcohol dependence, uncomplicated', 'F10', 'Alcohol related disorders', true),
  ('F10.21', 'Alcohol dependence, in remission', 'F10', 'Alcohol related disorders', true)

ON CONFLICT (code) DO NOTHING;
