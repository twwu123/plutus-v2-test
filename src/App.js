import './App.css';
import useYoroi from "./hooks/yoroiProvider";
import useWasm from "./hooks/useWasm";
import { bytesToHex, hexToBytes } from './utils/utils';

function App() {
  const { api, connect } = useYoroi()
  const wasm = useWasm()

  const jsonDataToWasmDatum = (data) => {
    if (data === "") {
      console.log("Empty Datum or Redeemer isn't allowed", "danger")
      throw Error("Empty Datum")
    }
    const dataObj = (typeof (data) === "string") ? JSON.parse(data) : data
    const keys = Object.keys(dataObj)
    switch (keys[0]) {
      case "fields":
        if (dataObj.constructor === undefined) {
          console.log("Fields datum doesn't have a constructor property", "danger")
          return
        }
        if (dataObj.fields.length === 0) {
          return wasm.PlutusData.new_empty_constr_plutus_data(wasm.BigNum.from_str(String(dataObj.constructor)))
        } else {
          const plutusList = wasm.PlutusList.new()
          for (let i = 0; i < dataObj.fields.length; i++) {
            plutusList.add(jsonDataToWasmDatum(dataObj.fields[i]))
          }
          return wasm.PlutusData.new_constr_plutus_data(
            wasm.ConstrPlutusData.new(
              wasm.BigNum.from_str(String(dataObj.constructor)),
              plutusList
            )
          )
        }
      case "constructor":
        if (!dataObj.fields) {
          console.log("Constructor datum doesn't have a fields property", "danger")
          return
        }
        if (dataObj.fields.length === 0) {
          return wasm.PlutusData.new_empty_constr_plutus_data(wasm.BigNum.from_str(String(dataObj.constructor)))
        } else {
          const plutusList = wasm.PlutusList.new()
          for (let i = 0; i < dataObj.fields.length; i++) {
            plutusList.add(jsonDataToWasmDatum(dataObj.fields[i]))
          }
          return wasm.PlutusData.new_constr_plutus_data(
            wasm.ConstrPlutusData.new(
              wasm.BigNum.from_str(String(dataObj.constructor)),
              plutusList
            )
          )
        }
      case "list":
        const plutusList = wasm.PlutusList.new()
        for (let i = 0; i < dataObj.list.length; i++) {
          plutusList.add(jsonDataToWasmDatum(dataObj.list))
        }
        return wasm.PlutusData.new_list(plutusList)
      case "map":
        if (dataObj.map.constructor.name === "Array") {
          const plutusList = wasm.PlutusList.new()
          for (let i = 0; i < dataObj.map.length; i++) {
            const plutusMap = wasm.PlutusMap.new()
            plutusMap.insert(jsonDataToWasmDatum(dataObj.map[i]["k"]), jsonDataToWasmDatum(dataObj.map[i]["v"]))
            plutusList.add(wasm.PlutusData.new_map(plutusMap))
          }
          return wasm.PlutusData.new_list(plutusList)
        } else {
          const plutusMap = wasm.PlutusMap.new()
          plutusMap.insert(jsonDataToWasmDatum(dataObj.map["k"]), jsonDataToWasmDatum(dataObj.map["v"]))
          return wasm.PlutusData.new_map(plutusMap)
        }
      case "int":
        return wasm.PlutusData.new_integer(wasm.BigInt.from_str(String(dataObj.int)))
      case "bytes":
        return wasm.PlutusData.new_bytes(hexToBytes(dataObj.bytes))
      default:
        console.log("Unknown data type detected, datum is probably incorrect", "danger")
        throw Error("Invalid Datum")
    }
  }

  const testSend = async () => {
    const txBuilder = wasm?.TransactionBuilder.new(
      wasm.TransactionBuilderConfigBuilder.new()
        .fee_algo(
          wasm.LinearFee.new(
            wasm.BigNum.from_str("44"),
            wasm.BigNum.from_str("155381")
          )
        )
        .coins_per_utxo_word(wasm.BigNum.from_str('34482'))
        .pool_deposit(wasm.BigNum.from_str('500000000'))
        .key_deposit(wasm.BigNum.from_str('2000000'))
        .ex_unit_prices(wasm.ExUnitPrices.new(
          wasm.UnitInterval.new(wasm.BigNum.from_str("577"), wasm.BigNum.from_str("10000")),
          wasm.UnitInterval.new(wasm.BigNum.from_str("721"), wasm.BigNum.from_str("10000000"))
        ))
        .max_value_size(5000)
        .max_tx_size(16384)
        .build()
    )

    // build output value, so we can do utxo selection for it. We will use 4 ADA and token, so there is enough for fees + output
    const wasmValue = wasm.Value.new(wasm.BigNum.from_str("4000000"))
    const wasmMultiasset = wasm.MultiAsset.new()
    const wasmAssets = wasm.Assets.new()
    wasmAssets.insert(wasm.AssetName.new(hexToBytes("544e4654")), wasm.BigNum.from_str("1"))
    wasmMultiasset.insert(wasm.ScriptHash.from_bytes(hexToBytes("4b5af10887c3adb169ef36524a2801de39099a96662682e64302be69")), wasmAssets)
    wasmValue.set_multiasset(wasmMultiasset)

    // Yoroi API can perform utxo selection automatically based on the values
    const hexInputUtxos = await api.getUtxos(bytesToHex(wasmValue.to_bytes()))

    // Then we can add the utxos selected to the input
    const wasmTxInputsBuilder = wasm.TxInputsBuilder.new()
    for (let i = 0; i < hexInputUtxos.length; i++) {
      const wasmUtxo = wasm.TransactionUnspentOutput.from_bytes(hexToBytes(hexInputUtxos[i]))
      wasmTxInputsBuilder.add_input(wasmUtxo.output().address(), wasmUtxo.input(), wasmUtxo.output().amount())
    }
    txBuilder.set_inputs(wasmTxInputsBuilder)

    // build the actual output, we need the output's Datum and the value. Then we output it all to the script's address
    const wasmDatum = jsonDataToWasmDatum({
      "int": 1
    })

    // This is a simple way of doing it, we can just set the output coin to 2 ADA, this should guarantee it is enough for min UTXO value
    // By using the original wasmValue, we can avoid rebuilding the Asset values
    wasmValue.set_coin((wasm.BigNum.from_str("2000000")))
    const contractAddress = "addr_test1wrh5pj6nlmdrmtv6uv69edjh5x3gx7px7zchxag47s23gtgu02rzy"
    const wasmContractAddress = wasm.Address.from_bech32(contractAddress)
    const wasmOutput = wasm.TransactionOutput.new(
      wasmContractAddress,
      wasmValue
    )

    wasmOutput.set_plutus_data(wasmDatum)
    txBuilder.add_output(wasmOutput)

    const hexChangeAddress = await api.getChangeAddress()
    const wasmChangeAddress = wasm.Address.from_bytes(hexToBytes(hexChangeAddress))
    txBuilder.add_change_if_needed(wasmChangeAddress)

    const unsignedTransactionHex = bytesToHex(txBuilder.build_tx().to_bytes())

    api?.signTx(unsignedTransactionHex)
      .then((witnessSetHex) => {
        const wasmWitnessSet = wasm.TransactionWitnessSet.from_bytes(
          hexToBytes(witnessSetHex)
        )
        const wasmTx = wasm.Transaction.from_bytes(
          hexToBytes(unsignedTransactionHex)
        )
        const wasmSignedTransaction = wasm.Transaction.new(
          wasmTx.body(),
          wasmWitnessSet,
          wasmTx.auxiliary_data()
        )
        const transactionHex = bytesToHex(wasmSignedTransaction.to_bytes())
        console.log(transactionHex)
        api.submitTx(transactionHex)
          .then(txId => {
            console.log(`Transaction successfully submitted: ${txId}`)
          })
          .catch(err => {
            console.log(err)
          })
      })
  }

  const testRedeem = async () => {
    const txBuilder = wasm?.TransactionBuilder.new(
      wasm.TransactionBuilderConfigBuilder.new()
        .fee_algo(
          wasm.LinearFee.new(
            wasm.BigNum.from_str("44"),
            wasm.BigNum.from_str("155381")
          )
        )
        .coins_per_utxo_word(wasm.BigNum.from_str('34482'))
        .pool_deposit(wasm.BigNum.from_str('500000000'))
        .key_deposit(wasm.BigNum.from_str('2000000'))
        .ex_unit_prices(wasm.ExUnitPrices.new(
          wasm.UnitInterval.new(wasm.BigNum.from_str("577"), wasm.BigNum.from_str("10000")),
          wasm.UnitInterval.new(wasm.BigNum.from_str("721"), wasm.BigNum.from_str("10000000"))
        ))
        .max_value_size(5000)
        .max_tx_size(16384)
        .build()
    )

    const transactionHash = "2cb6def143969af84236fa66048d0af1bd4164ed9feedf1460ebd50494c21a72"
    const outputId = "0"
    const plutusScriptHex = "590ab4590ab10100003233223233223322323232323232323232323232323232323232323232323232323222322323253353232323232325335005102d153355335302553355335333573466e1ccd54078c084480054005200002d02c132632027335738920131534352495054283536293a204e6f20736372697074205554784f7320696e70757420746f207472616e73616374696f6e2e0002b1500113500d01f2210021335738920130436f6e67726174756c6174696f6e732120596f75206861766520696e70757420616e20696e6c696e6520646174756d2e0002d102c15335302553355335333573466e1ccd54078c084480054009200002d02c132632027335738921274e6f20736372697074205554784f73206f75747075742066726f6d207472616e73616374696f6e0002b1500213500d01f2210021335738920131436f6e67726174756c6174696f6e732120596f752068617665206f757470757420616e20696e6c696e6520646174756d2e0002d102c102c133355301f12001225335533535350022222004223350022502d23502e0012102f102d1335028002001100150273355301c120012350012200135500222222222222200c133355301e12001225335533535350022222004223350022502c23502d0012102e102c13350270020011001502635500122222222222200a135001220023333573466e1cd55cea80224000466442466002006004646464646464646464646464646666ae68cdc39aab9d500c480008cccccccccccc88888888888848cccccccccccc00403403002c02802402001c01801401000c008cd4064068d5d0a80619a80c80d1aba1500b33501901b35742a014666aa03aeb94070d5d0a804999aa80ebae501c35742a01066a0320446ae85401cccd5407408dd69aba150063232323333573466e1cd55cea801240004664424660020060046464646666ae68cdc39aab9d5002480008cc8848cc00400c008cd40b5d69aba15002302e357426ae8940088c98c80e8cd5ce01781f01c09aab9e5001137540026ae854008c8c8c8cccd5cd19b8735573aa004900011991091980080180119a816bad35742a004605c6ae84d5d1280111931901d19ab9c02f03e038135573ca00226ea8004d5d09aba2500223263203633573805607406826aae7940044dd50009aba1500533501975c6ae854010ccd5407407c8004d5d0a801999aa80ebae200135742a00460426ae84d5d1280111931901919ab9c027036030135744a00226ae8940044d5d1280089aba25001135744a00226ae8940044d5d1280089aba25001135744a00226ae8940044d55cf280089baa00135742a00860226ae84d5d1280211931901219ab9c0190280223333573466e1d40152002212200223333573466e1d4019200021220012326320243357380320500440426eb401840944d401d2410350543500135573ca00226ea80044d55ce9baa001123263201b33573800203e2464460046eb0004c8004d5408488cccd55cf8009280f119a80e98021aba1002300335744004040464646666ae68cdc39aab9d5002480008cc8848cc00400c008c028d5d0a80118029aba135744a004464c6403866ae700440800684d55cf280089baa0012323232323333573466e1cd55cea8022400046666444424666600200a0080060046464646666ae68cdc39aab9d5002480008cc8848cc00400c008c04cd5d0a80119a8068091aba135744a004464c6404266ae7005809407c4d55cf280089baa00135742a008666aa010eb9401cd5d0a8019919191999ab9a3370ea0029002119091118010021aba135573ca00646666ae68cdc3a80124004464244460020086eb8d5d09aab9e500423333573466e1d400d20002122200323263202333573803004e04204003e26aae7540044dd50009aba1500233500975c6ae84d5d1280111931900e99ab9c01202101b135744a00226ae8940044d55cf280089baa0011335500175ceb44488c88c008dd5800990009aa80f11191999aab9f0022501c233501b33221233001003002300635573aa004600a6aae794008c010d5d100180f09aba100112232323333573466e1d4005200023501c3005357426aae79400c8cccd5cd19b87500248008940708c98c8068cd5ce00780f00c00b89aab9d500113754002464646666ae68cdc3a800a400c46424444600800a600e6ae84d55cf280191999ab9a3370ea004900211909111180100298049aba135573ca00846666ae68cdc3a801a400446424444600200a600e6ae84d55cf280291999ab9a3370ea00890001190911118018029bae357426aae7940188c98c8068cd5ce00780f00c00b80b00a89aab9d500113754002464646666ae68cdc39aab9d5002480008cc8848cc00400c008c014d5d0a8011bad357426ae8940088c98c8058cd5ce00580d00a09aab9e5001137540024646666ae68cdc39aab9d5001480008dd71aba135573ca004464c6402866ae700240600484dd5000919191919191999ab9a3370ea002900610911111100191999ab9a3370ea004900510911111100211999ab9a3370ea00690041199109111111198008048041bae35742a00a6eb4d5d09aba2500523333573466e1d40112006233221222222233002009008375c6ae85401cdd71aba135744a00e46666ae68cdc3a802a400846644244444446600c01201060186ae854024dd71aba135744a01246666ae68cdc3a8032400446424444444600e010601a6ae84d55cf280591999ab9a3370ea00e900011909111111180280418071aba135573ca018464c6403a66ae7004808406c06806406005c0580544d55cea80209aab9e5003135573ca00426aae7940044dd50009191919191999ab9a3370ea002900111999110911998008028020019bad35742a0086eb4d5d0a8019bad357426ae89400c8cccd5cd19b875002480008c8488c00800cc020d5d09aab9e500623263201633573801603402802626aae75400c4d5d1280089aab9e500113754002464646666ae68cdc3a800a400446424460020066eb8d5d09aab9e500323333573466e1d400920002321223002003375c6ae84d55cf280211931900999ab9c008017011010135573aa00226ea8004488c8c8cccd5cd19b87500148010848880048cccd5cd19b875002480088c84888c00c010c018d5d09aab9e500423333573466e1d400d20002122200223263201433573801203002402202026aae7540044dd50009191999ab9a3370ea0029001100a91999ab9a3370ea0049000100a91931900819ab9c00501400e00d135573a6ea800524103505431003200135501122112253350011500f2213350103004002335530061200100400111223333550023233500922333500a0030010023500700133500822230033002001200122337000029001000a400092103505438003200135500e22112225335001100222133005002333553007120010050040013200135500d22112225335001135006003221333500900530040023335530071200100500400112350012200112350012200212212330010030022533353500122220021326320033357389213a534352495054283639293a205468657265206973206e6f20646174756d20617474616368656420746f2074686520736372697074205554784f2e000072100a213263200433573892012d534352495054283730293a20596f752068617665206e6f74207573656420616e20696e6c696e6520646174756d000084984488008488488cc00401000c48488c00800c448800448004488008488004448c8c00400488cc00cc0080080041"
    const wasmRedeemData = jsonDataToWasmDatum({
      "fields": [],
      "constructor": 0
    })

    const wasmRedeemer = wasm.Redeemer.new(
      wasm.RedeemerTag.new_spend(),
      wasm.BigNum.zero(),
      wasmRedeemData,
      wasm.ExUnits.new(
        wasm.BigNum.from_str("942996"),
        wasm.BigNum.from_str("346100241")
      )
    )

    // Set up the tx inputs builder
    const wasmTxInputsBuilder = wasm.TxInputsBuilder.new()

    // The data is actually inlined, so datum shouldn't be required, but the current Serialization Lib doesn't allow this
    // So we will just build the entire script witness with datum first, we will manually remove the datum later
    const plutusScriptWitness = wasm.PlutusWitness.new(
      wasm.PlutusScript.from_bytes_v2(hexToBytes(plutusScriptHex)),
      jsonDataToWasmDatum({"int": 1}),
      wasmRedeemer
    )

    // Next build the Tx Input and Value
    const wasmTxInput = wasm.TransactionInput.new(
      wasm.TransactionHash.from_bytes(
        hexToBytes(
          transactionHash
        )
      ),
      outputId
    )

    // This is just a test, so we'll just manually add the values, normally these values would be stored in some backend of some sort
    // and grabbed from it.
    const wasmValue = wasm.Value.new(wasm.BigNum.from_str("2000000"))
    const wasmMultiAsset = wasm.MultiAsset.new()
    const wasmAssets = wasm.Assets.new()
    wasmAssets.insert(wasm.AssetName.new(hexToBytes("544e4654")), wasm.BigNum.from_str("1"))
    wasmMultiAsset.insert(wasm.ScriptHash.from_bytes(hexToBytes("4b5af10887c3adb169ef36524a2801de39099a96662682e64302be69")), wasmAssets)
    wasmValue.set_multiasset(wasmMultiAsset)

    // wasmValue.set_multiasset(wasmMultiAsset)
    // Finally we add the plutus script input to the inputs builder
    wasmTxInputsBuilder.add_plutus_script_input(plutusScriptWitness, wasmTxInput, wasmValue)
    // Maybe add some more value to pay fees and extra outputs
    const hexInputUtxos = await api.getUtxos("5000000")
    for (let i = 0; i < hexInputUtxos.length; i++) {
      const wasmUtxo = wasm.TransactionUnspentOutput.from_bytes(hexToBytes(hexInputUtxos[i]))
      wasmTxInputsBuilder.add_input(wasmUtxo.output().address(), wasmUtxo.input(), wasmUtxo.output().amount())
    }
    // Then we can set the tx inputs to the tx inputs builder
    txBuilder.set_inputs(wasmTxInputsBuilder)

    // For plutus transactions, we need some collateral also
    const hexCollateralUtxos = await api?.getCollateral(3000000)
    const collateralTxInputsBuilder = wasm.TxInputsBuilder.new()
    for (let i = 0; i < hexCollateralUtxos.length; i++) {
      const wasmUtxo = wasm.TransactionUnspentOutput.from_bytes(hexToBytes(hexCollateralUtxos[i]))
      collateralTxInputsBuilder.add_input(wasmUtxo.output().address(), wasmUtxo.input(), wasmUtxo.output().amount())
    }
    txBuilder.set_collateral(collateralTxInputsBuilder)

    // The script ensures that there is an output back to the script with some datum, so we'll add this output
    const wasmContractAddress = wasm.Address.from_bech32("addr_test1wrh5pj6nlmdrmtv6uv69edjh5x3gx7px7zchxag47s23gtgu02rzy")
    const wasmOutput = wasm.TransactionOutput.new(
      wasmContractAddress,
      wasm.Value.new(wasm.BigNum.from_str("2000000"))
    )
    wasmOutput.set_plutus_data(jsonDataToWasmDatum({"int": 1}))
    txBuilder.add_output(wasmOutput)

    // We need to handle hashing of plutus witness. Because the datum is actually included inline within the script UTXO
    // therefore, we need to intentionally leave out the datum in the witness set for the hash.
    const wasmRedeemers = wasm.Redeemers.new()
    wasmRedeemers.add(wasmRedeemer)
    // The cost models of v2 scripts must be manually built currently
    const cost_model_vals = [205665, 812, 1, 1, 1000, 571, 0, 1, 1000, 24177, 4, 1, 1000, 32, 117366, 10475, 4, 23000, 100, 23000, 100, 23000, 100, 23000, 100, 23000, 100, 23000, 100, 100, 100, 23000, 100, 19537, 32, 175354, 32, 46417, 4, 221973, 511, 0, 1, 89141, 32, 497525, 14068, 4, 2, 196500, 453240, 220, 0, 1, 1, 1000, 28662, 4, 2, 245000, 216773, 62, 1, 1060367, 12586, 1, 208512, 421, 1, 187000, 1000, 52998, 1, 80436, 32, 43249, 32, 1000, 32, 80556, 1, 57667, 4, 1000, 10, 197145, 156, 1, 197145, 156, 1, 204924, 473, 1, 208896, 511, 1, 52467, 32, 64832, 32, 65493, 32, 22558, 32, 16563, 32, 76511, 32, 196500, 453240, 220, 0, 1, 1, 69522, 11687, 0, 1, 60091, 32, 196500, 453240, 220, 0, 1, 1, 196500, 453240, 220, 0, 1, 1, 1159724, 392670, 0, 2, 806990, 30482, 4, 1927926, 82523, 4, 265318, 0, 4, 0, 85931, 32, 205665, 812, 1, 1, 41182, 32, 212342, 32, 31220, 32, 32696, 32, 43357, 32, 32247, 32, 38314, 32, 20000000000, 20000000000, 9462713, 1021, 10, 20000000000, 0, 20000000000]
    const costModel = wasm.CostModel.new();
    cost_model_vals.forEach((x, i) => costModel.set(i, wasm.Int.new(wasm.BigNum.from_str(String(x)))));
    const costmdls = wasm.Costmdls.new()
    costmdls.insert(wasm.Language.new_plutus_v2(), costModel)
    // I intentionally put an undefined where the datum should go to make it clearer, but the argument can simply be left empty
    const plutusWitnessHash = wasm.hash_script_data(wasmRedeemers, costmdls, undefined)
    console.log(bytesToHex(plutusWitnessHash.to_bytes()))
    txBuilder.set_script_data_hash(plutusWitnessHash)

    // Handle change
    const hexChangeAddress = await api?.getChangeAddress()
    const wasmChangeAddress = wasm.Address.from_bytes(hexToBytes(hexChangeAddress))
    txBuilder.add_change_if_needed(wasmChangeAddress)

    const unsignedTransactionHex = bytesToHex(txBuilder.build_tx().to_bytes())
    api?.signTx(unsignedTransactionHex)
      .then((witnessSetHex) => {
        // Go through a fairly annoying process of manually removing the datum from the witness set
        // Unfortunately, the Serialization lib doesn't allow us to simply set the datum as undefined, so we need to remake
        // the witness set, and simply not set the datum
        const wasmWitnessSetCopy = wasm.TransactionWitnessSet.from_bytes(
          hexToBytes(witnessSetHex)
        )
        const wasmWitnessSet = wasm.TransactionWitnessSet.new()
        wasmWitnessSet.set_plutus_scripts(wasmWitnessSetCopy.plutus_scripts())
        wasmWitnessSet.set_redeemers(wasmWitnessSetCopy.redeemers())
        wasmWitnessSet.set_vkeys(wasmWitnessSetCopy.vkeys())
        const wasmTx = wasm.Transaction.from_bytes(
          hexToBytes(unsignedTransactionHex)
        )
        const wasmSignedTransaction = wasm.Transaction.new(
          wasmTx.body(),
          wasmWitnessSet,
          wasmTx.auxiliary_data()
        )
        const transactionHex = bytesToHex(wasmSignedTransaction.to_bytes())
        console.log(transactionHex)
        api.submitTx(transactionHex)
          .then(txId => {
            console.log(`Transaction successfully submitted: ${txId}`)
          })
          .catch(err => {
            console.log(err.info)
          })
      }).catch(err => {
        console.log(err.info)
      })
  }

  return (

    <div className="App">
      <div>
        {api ?
          <h5>Connected</h5>
          :
          <button onClick={() => connect(true, false)}>Request Access To Yoroi</button>
        }
      </div>
      <div>
        <button onClick={testSend}>Test Send</button>
      </div>
      <div>
        <button onClick={testRedeem}>Test Redeem</button>
      </div>
    </div>
  );
}

export default App;
