{-# INLINABLE check #-}
check :: Integer -> Action -> ScriptContext -> Bool
check _ Cancel _ = True
check _ Test ctx = inlineDatumIn' && inlineDatumOut'
    where
        txInfo :: TxInfo
        txInfo = scriptContextTxInfo ctx

        -- | Transaction inputs
        txIns :: [ TxInInfo ]
        txIns = txInfoInputs txInfo

        -- | Transaction inputs that are UTxOs
        utxosIn :: [ TxOut ]
        utxosIn = map txInInfoResolved txIns

        -- | Transaction inputs that are script UTxOs
        scriptUTxOsIn :: [ TxOut ]
        scriptUTxOsIn =
            let xs = filter (isJust . toValidatorHash . txOutAddress) utxosIn
            in if length xs == 0
               then traceError "SCRIPT(56): No script UTxOs input to transaction."
               else xs

        inlineDatumIn' :: Bool
        inlineDatumIn' = traceIfTrue "Congratulations! You have input an inline datum." inlineDatumIn 
        inlineDatumIn = (inlineDatum . head) scriptUTxOsIn

        inlineDatum :: TxOut -> Bool
        inlineDatum txo = case txOutDatum txo of
                          NoOutputDatum -> traceError "SCRIPT(69): There is no datum attached to the script UTxO."
                          OutputDatumHash _ -> traceError "SCRIPT(70): You have not used an inline datum"
                          OutputDatum _ -> True

        utxosOut :: [ TxOut ]
        utxosOut = txInfoOutputs txInfo

        scriptUTxOsOut :: [ TxOut ]
        scriptUTxOsOut = 
            let xs = filter (isJust . toValidatorHash . txOutAddress) utxosOut
            in if length xs == 0
               then traceError "No script UTxOs output from transaction"
               else xs

        inlineDatumOut' :: Bool
        inlineDatumOut' = traceIfTrue "Congratulations! You have output an inline datum." inlineDatumOut
        inlineDatumOut = (inlineDatum . head) scriptUTxOsOut