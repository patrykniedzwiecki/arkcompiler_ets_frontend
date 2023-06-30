/*
 * Copyright (c) 2023 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ListUtil} from '../../../src/utils/ListUtil';
import {describe, it} from 'mocha';
import {assert} from 'chai';

describe('unit test for ListUtil.ts', function () {
  describe('get init list test', function () {
    it('check init list input value bad', function () {
      let arr = ListUtil.getInitList(-1);
      assert.isTrue(arr.length === 0);
    });

    it('check init list input value zero', function () {
      let arr = ListUtil.getInitList(0);
      assert.isTrue(arr.length === 0);
    });

    it('check init list input value NaN', function () {
      let arr = ListUtil.getInitList(NaN);
      assert.isTrue(arr.length === 0);
    });

    it('check init list input value MAX_INIT_LEN', function () {
      let arr = ListUtil.getInitList(ListUtil.MAX_INIT_LEN);
      assert.isTrue(arr.length === ListUtil.MAX_INIT_LEN);
    });

    it('check init list input value bigger than MAX_INIT_LEN', function () {
      let arr = ListUtil.getInitList(ListUtil.MAX_INIT_LEN + 1);
      assert.isTrue(arr.length === 0);
    });

    it('check init list input normal value', function () {
      let arr = ListUtil.getInitList(26);

      arr.forEach(((value, index) => {
        assert.strictEqual(value, index);
      }));
    });
  });

  describe('list shuffle test', function () {
    it('check shuffle invalid list', function () {
      let arr = undefined;
      ListUtil.shuffle(arr);

      assert.isTrue(true);
    });

    it('check shuffle list', function () {
      let arr = ListUtil.getInitList(26);
      ListUtil.shuffle(arr);

      for (let i = 1; i < arr.length; i++) {
        const isShuffled = arr[i] !== i || Math.abs(arr[i - 1] - arr[i]) > 1;
        assert.isTrue(isShuffled);
      }
    });
  });

  describe('list unique merge test', function () {
    it('check unique merge two undefined list', function () {
      let arr1 = undefined;
      let arr2 = undefined;

      const arrUnique = ListUtil.uniqueMergeList(arr1, arr2);
      assert.isTrue(arrUnique.length === 0);
    });

    it('check unique merge two unique list', function () {
      let arr1 = ['1', '2', '3'];
      let arr2 = ['4', '5', '6'];

      const expectedArr = ['1', '2', '3', '4', '5', '6'];

      const arrUnique = ListUtil.uniqueMergeList(arr1, arr2);
      assert.isTrue(arrUnique.length === expectedArr.length);
      arrUnique.forEach((value, index) => {
        assert.strictEqual(value, expectedArr[index]);
      });
    });

    it('check unique merge two not unique list', function () {
      let arr1 = ['1', '2', '3', '4'];
      let arr2 = ['4', '5', '4', '6'];

      const expectedArr = ['1', '2', '3', '4', '5', '6'];

      const arrUnique = ListUtil.uniqueMergeList(arr1, arr2);
      assert.isTrue(arrUnique.length === expectedArr.length);
      arrUnique.forEach((value, index) => {
        assert.strictEqual(value, expectedArr[index]);
      });
    });

    it('check unique merge three undefined list', function () {
      let arr1 = undefined;
      let arr2 = undefined;
      let arr3 = undefined;

      const arrUnique = ListUtil.uniqueMergeList(arr1, arr2, arr3);
      assert.isTrue(arrUnique.length === 0);
    });

    it('check unique merge three unique list', function () {
      let arr1 = ['1', '2', '3'];
      let arr2 = ['4', '5', '6'];
      let arr3 = ['7', '8', '9'];

      const expectedArr = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

      const arrUnique = ListUtil.uniqueMergeList(arr1, arr2, arr3);
      assert.isTrue(arrUnique.length === expectedArr.length);
      arrUnique.forEach((value, index) => {
        assert.strictEqual(value, expectedArr[index]);
      });
    });

    it('check unique merge three not unique list', function () {
      let arr1 = ['1', '2', '3', '4'];
      let arr2 = ['4', '5', '4', '6'];
      let arr3 = ['6', '7', '8', '8'];

      const expectedArr = ['1', '2', '3', '4', '5', '6', '7', '8'];

      const arrUnique = ListUtil.uniqueMergeList(arr1, arr2, arr3);
      assert.isTrue(arrUnique.length === expectedArr.length);
      arrUnique.forEach((value, index) => {
        assert.strictEqual(value, expectedArr[index]);
      });
    });
  });
});
